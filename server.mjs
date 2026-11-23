// Orchestra desktop UI: a local server (127.0.0.1 only) + ui.html, opened as an Edge app window.
// Start: node server.mjs   (or double-click Orchestra.cmd). Add --no-open to skip the window.
import http from 'node:http';
import { readFileSync, readdirSync, mkdirSync, createReadStream, statSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execFile } from 'node:child_process';
import { config, planRun, runStep, guidance, listSkills, skillName, skillsDir } from './orchestra.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ORCHESTRA_PORT) || 4545;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Only our own page may start agents: blocks other websites from POSTing to this local server.
export const isAllowedOrigin = (origin) => origin === ORIGIN || origin === `http://localhost:${PORT}`;

export const projectDir = (job, dir) => {
  if (dir?.trim()) return isAbsolute(dir.trim()) ? dir.trim() : resolve(here, 'projects', dir.trim());
  const slug = job.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  return resolve(here, 'projects', slug);
};

let run = null; // { dir, events, running }
const clients = new Set();
const emit = (ev) => {
  run.events.push(ev);
  for (const c of clients) c.write(`data: ${JSON.stringify(ev)}\n\n`);
};

function startRun({ job, dir, flow, from, skills = [], rules = '' }) {
  const plan = planRun(job, flow || undefined, from || undefined); // throws on bad flow/step -> 400
  const target = projectDir(job, dir);
  guidance(target, skills); // throws on an unknown skill before anything is written
  mkdirSync(target, { recursive: true });
  if (rules.trim()) writeFileSync(join(target, 'RULES.md'), rules.trim() + '\n'); // empty = keep the folder's existing rules
  const extra = guidance(target, skills);
  run = { dir: target, events: [], running: true };
  emit({ type: 'start', job, flow: plan.flow, dir: target, skills: extra.skills.map(s => s.name), hasRules: !!extra.rules,
    steps: plan.steps.map(s => ({ name: s.name, agent: s.agent, model: config.agents[s.agent].model })) });
  (async () => {
    let ok = true;
    for (const [i, step] of plan.steps.entries()) {
      emit({ type: 'step', index: i, status: 'running', at: Date.now() });
      const code = await runStep(step, job, target, d => emit({ type: 'log', text: String(d) }), extra);
      emit({ type: 'step', index: i, status: code === 0 ? 'done' : 'failed', at: Date.now() });
      if (code !== 0) { ok = false; break; }
    }
    run.running = false;
    emit({ type: 'done', ok, files: readdirSync(target) });
  })();
}

const readBody = (req) => new Promise((ok, fail) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => ok(b));
  req.on('error', fail);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  if (req.method === 'POST' && !isAllowedOrigin(req.headers.origin)) return send(403, { error: 'Forbidden origin' });
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(200, readFileSync(join(here, 'ui.html')), TYPES['.html']);
    if (url.pathname === '/api/config') return send(200, config);
    if (req.method === 'GET' && url.pathname === '/api/skills') return send(200, listSkills());
    if (req.method === 'POST' && url.pathname === '/api/skills') {
      const { name, content, delete: del } = JSON.parse((await readBody(req)) || '{}');
      const file = join(skillsDir, `${skillName(name)}.md`);
      if (del) rmSync(file, { force: true });
      else {
        if (!content?.trim()) return send(400, { error: 'Write what the skill should teach the agents.' });
        mkdirSync(skillsDir, { recursive: true });
        writeFileSync(file, content.trim() + '\n');
      }
      return send(200, { ok: true, name: skillName(name) });
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      for (const ev of run?.events ?? []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (run?.running) return send(409, { error: 'A job is already running. Wait for it to finish.' });
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.job?.trim()) return send(400, { error: 'Describe the job first.' });
      startRun({ ...body, job: body.job.trim() });
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/open-folder' && run) {
      execFile('explorer', [run.dir]);
      return send(200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/') && run) {
      const file = resolve(run.dir, decodeURIComponent(url.pathname.slice('/files/'.length)));
      const rel = relative(run.dir, file);
      if (rel.startsWith('..') || isAbsolute(rel) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return send(404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      return createReadStream(file).pipe(res);
    }
    send(404, { error: 'Not found' });
  } catch (e) {
    send(400, { error: e.message });
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Orchestra is running at ${ORIGIN}  (keep this window open; close it to stop)`);
    if (process.platform === 'win32' && !process.argv.includes('--no-open'))
      exec(`start "" msedge --app=${ORIGIN}`, err => err && console.log('Could not open Edge. Open the address above in your browser.'));
  });
}
