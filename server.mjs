// Orchestra app: a local server (127.0.0.1 only) + ui.html, opened as an Edge app window.
// Start: node server.mjs   (or double-click Orchestra.cmd). Add --no-open to skip the window.
// A second server on PORT+1 serves project files for the Preview tab, on its own origin, so a
// previewed page can't call Orchestra's API.
import http from 'node:http';
import { readFileSync, readdirSync, mkdirSync, createReadStream, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { config, planRun, checkSteps, runStep, guidance, listSkills, skillName, skillsDir, killTree,
  loadSettings, saveSettings, permissionRules, writeRuntimeFile, PUBLISH_TOOLS } from './orchestra.mjs';
import { slug, chatPrompt, runChat, parseRunBlock, chatCommand, MODES, toolSummary } from './chat.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ORCHESTRA_PORT) || 4545;
const PREVIEW_PORT = Number(process.env.ORCHESTRA_PREVIEW_PORT) || PORT + 1;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const projectsRoot = resolve(here, 'projects');
const sessionsDir = resolve(here, 'sessions');
const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

// Only our own page may change anything: blocks other websites (and previewed pages) from POSTing here.
export const isAllowedOrigin = (origin) => origin === ORIGIN || origin === `http://localhost:${PORT}`;

// Used by the terminal flow and kept for old callers: a folder name under projects/, or a full path.
export const projectDir = (job, dir) => {
  if (dir?.trim()) return isAbsolute(dir.trim()) ? dir.trim() : resolve(here, 'projects', dir.trim());
  const s = job.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  return resolve(here, 'projects', s);
};

// A path inside root, or null if it would escape it.
export function inside(root, rel) {
  const file = resolve(root, rel);
  const r = relative(root, file);
  return !r || r.startsWith('..') || isAbsolute(r) ? null : file;
}

export function projectPath(name) {
  if (!name || slug(name) !== name) throw new Error(`"${name}" is not a valid project name.`);
  return join(projectsRoot, name);
}

const listProjects = () => existsSync(projectsRoot)
  ? readdirSync(projectsRoot, { withFileTypes: true }).filter(d => d.isDirectory() && slug(d.name) === d.name).map(d => d.name) : [];

// Every file and folder in a project, for the explorer. Skips dependency and hidden folders.
const SKIP = new Set(['node_modules', '.git']);
export function listFiles(dir, max = 3000) {
  const out = [];
  const walk = (abs, rel) => {
    let entries; try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= max) return;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        out.push({ path: p, type: 'dir' }); walk(join(abs, e.name), p);
      } else out.push({ path: p, type: 'file', size: statSync(join(abs, e.name), { throwIfNoEntry: false })?.size ?? 0 });
    }
  };
  walk(dir, '');
  return out;
}

// One folder's direct children, VS Code order: folders first, then files, by name. Only .git is hidden.
export function listDir(root, rel = '') {
  const abs = rel ? inside(root, rel) : root;
  if (!abs) throw new Error('That path is outside the project.');
  let entries; try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return []; }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  return entries.filter(e => e.name !== '.git')
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || byName(a, b))
    .map(e => ({ name: e.name, path: rel ? `${rel}/${e.name}` : e.name, type: e.isDirectory() ? 'dir' : 'file',
      size: e.isDirectory() ? 0 : statSync(join(abs, e.name), { throwIfNoEntry: false })?.size ?? 0 }));
}

// ---------- Events (Server-Sent Events to every open window) ----------
let run = null; // { id, sessionId, project, dir, events, running, stopped, child }
const clients = new Set();
const broadcast = (ev) => { for (const c of clients) c.write(`data: ${JSON.stringify(ev)}\n\n`); };
const emit = (ev) => { run.events.push(ev); broadcast(ev); };

// ---------- Chat sessions (saved as sessions/<id>.json) ----------
const cache = new Map();
const validId = (id) => /^[a-z0-9-]{6,40}$/.test(String(id ?? ''));
function loadSession(id) {
  if (!validId(id)) throw new Error('Unknown chat.');
  if (!cache.has(id)) {
    const file = join(sessionsDir, `${id}.json`);
    if (!existsSync(file)) throw new Error('Unknown chat.');
    const s = JSON.parse(readFileSync(file, 'utf8'));
    for (const m of s.messages) if (m.role === 'build' && m.status === 'running' && !(run?.running && run.id === m.runId)) m.status = 'interrupted';
    cache.set(id, s);
  }
  return cache.get(id);
}
function saveSession(s) {
  s.updatedAt = Date.now();
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, `${s.id}.json`), JSON.stringify(s, null, 1));
  broadcast({ type: 'session', id: s.id });
}
function listSessions() {
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir).filter(f => f.endsWith('.json')).map(f => {
    try { const s = loadSession(f.slice(0, -5)); return { id: s.id, title: s.title || 'New chat', project: s.project, updatedAt: s.updatedAt }; }
    catch { return null; }
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}
function newSession(project = null) {
  if (project) projectPath(project);
  const s = { id: randomUUID().slice(0, 8), title: '', project, messages: [], createdAt: Date.now() };
  saveSession(s);
  return s;
}

// ---------- Builds ----------
function startRun({ job, project, flow, from, skills = [], steps = null, sessionId = null }) {
  if (run?.running) throw new Error('A build is already running. Wait for it to finish or press Stop.');
  const plan = planRun(job, flow || undefined, from || undefined, steps || undefined); // throws on bad flow/step
  const target = projectPath(project);
  guidance(target, skills); // throws on an unknown skill before anything is written
  mkdirSync(target, { recursive: true });
  const extra = guidance(target, skills);
  run = { id: randomUUID().slice(0, 8), sessionId, project, dir: target, events: [], running: true, stopped: false, child: null };
  const session = sessionId ? loadSession(sessionId) : null;
  const card = { role: 'build', runId: run.id, status: 'running', flow: plan.flow, project, skills: extra.skills.map(s => s.name), brief: job, from: from || null, at: Date.now(),
    ...(steps && { steps: checkSteps(steps) }) }; // the full custom list, so Retry can resend it
  if (session) { session.messages.push(card); saveSession(session); }
  emit({ type: 'start', runId: run.id, sessionId, project, job, flow: plan.flow, dir: target, skills: card.skills, hasRules: !!extra.rules,
    steps: plan.steps.map(s => ({ name: s.name, agent: s.agent, model: config.agents[s.agent].model, cli: config.agents[s.agent].cli })) });
  const thisRun = run;
  (async () => {
    let ok = true;
    for (const [i, step] of plan.steps.entries()) {
      emit({ type: 'step', index: i, status: 'running', at: Date.now() });
      const code = await runStep(step, job, target, d => emit({ type: 'log', text: String(d) }), extra, c => { thisRun.child = c; });
      const status = thisRun.stopped ? 'stopped' : code === 0 ? 'done' : 'failed';
      emit({ type: 'step', index: i, status, at: Date.now() });
      if (status !== 'done') { ok = false; break; }
    }
    thisRun.running = false; thisRun.child = null;
    const files = readdirSync(target);
    emit({ type: 'done', ok, stopped: thisRun.stopped, project, files });
    if (session) {
      card.status = ok ? 'done' : thisRun.stopped ? 'stopped' : 'failed';
      card.files = files.filter(f => !f.startsWith('.'));
      card.failedStep = ok ? null : plan.steps[thisRun.events.filter(e => e.type === 'step' && e.status !== 'running').length - 1]?.name ?? null;
      saveSession(session);
    }
  })();
}

// ---------- Connectors (MCP servers the claude CLI can see) ----------
// "claude mcp list" lines look like:  claude.ai Astrocade: https://mcp.astrocade.com/mcp - ✔ Connected
const STATUS = { '✔': 'connected', '!': 'needs-auth', '✘': 'failed', '-': 'not-configured' };
export function parseMcpList(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(.+?): (.*) - ([✔✘!-]) (.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    const source = name.startsWith('claude.ai ') ? 'claude.ai' : name.startsWith('plugin:') ? 'plugin' : 'local';
    out.push({ name, target: m[2].trim(), status: STATUS[m[3]] ?? 'unknown', detail: m[4].trim(), source });
  }
  return out;
}
let checkingConnectors = false;
function refreshConnectors() {
  if (checkingConnectors) return;
  checkingConnectors = true;
  broadcast({ type: 'connectors' });
  exec('claude mcp list', { cwd: here, timeout: 180000, maxBuffer: 4e6, windowsHide: true }, (err, stdout) => {
    const servers = parseMcpList(stdout);
    if (servers.length) {
      const s = loadSettings();
      s.connectors = { ...(s.connectors ?? {}), servers, checkedAt: Date.now() };
      saveSettings(s);
    }
    checkingConnectors = false;
    broadcast({ type: 'connectors', error: servers.length ? null : (err?.message ?? 'No MCP servers found.') });
  });
}
function connectorList() {
  const c = loadSettings().connectors ?? {};
  const off = new Set(c.disabled ?? []);
  return { servers: (c.servers ?? []).map(x => ({ ...x, enabled: !off.has(x.name) })), checkedAt: c.checkedAt ?? null, checking: checkingConnectors };
}

// ---------- Approvals: the chat agent asks before risky actions (see approve-mcp.mjs) ----------
const TOKEN = randomUUID();
const approvals = new Map(); // id -> { id, chat, tool, summary, input, resolve }
function requestApproval({ chat, tool, input }) {
  return new Promise(resolve => {
    let s; try { s = loadSession(chat); } catch { return resolve({ allow: false, message: 'Unknown chat.' }); }
    if (!chats.has(chat)) return resolve({ allow: false, message: 'This chat turn has ended.' });
    const publishing = PUBLISH_TOOLS.includes(tool);
    if (!publishing && (s.mode === 'full' || s.alwaysAllow?.includes(tool))) return resolve({ allow: true });
    const a = { id: randomUUID().slice(0, 8), chat, tool, summary: toolSummary(tool, input), input, resolve };
    approvals.set(a.id, a);
    broadcast({ type: 'approval', id: a.id, chat, tool, summary: a.summary, input });
  });
}
function answerApproval(id, allow, message) {
  const a = approvals.get(id);
  if (!a) return false;
  approvals.delete(id);
  a.resolve(allow ? { allow: true } : { allow: false, message: message || 'The user denied this action.' });
  broadcast({ type: 'approval-done', id, chat: a.chat });
  return true;
}
const pendingFor = (chat) => [...approvals.values()].filter(a => a.chat === chat).map(({ resolve, ...a }) => a);

// ---------- Chat turns ----------
const chats = new Map(); // session id -> { child, stopped }
function chatTurn(s, text) {
  if (chats.has(s.id)) throw new Error('Wait for the reply to finish, or press Stop.');
  s.messages.push({ role: 'user', text, at: Date.now() });
  if (!s.title) s.title = text.replace(/\s+/g, ' ').slice(0, 60);
  saveSession(s);
  const cwd = s.project ? projectPath(s.project) : projectsRoot;
  mkdirSync(cwd, { recursive: true });
  const mode = MODES[s.mode] ? s.mode : 'ask';
  const { servers } = connectorList();
  const prompt = chatPrompt({
    message: text, history: s.messages.slice(0, -1), project: s.project, mode, cwd,
    connectors: servers.filter(c => c.enabled && c.status === 'connected').map(c => c.name),
    files: s.project ? listFiles(cwd).filter(f => f.type === 'file').map(f => f.path) : [],
    projects: listProjects(), skills: listSkills(), running: run?.running ? run.project : null,
  });
  // Per-turn files for the CLI: permission rules, and the approval MCP server that asks the user.
  const settingsFile = writeRuntimeFile(`chat-${s.id}.settings.json`, { permissions: permissionRules({ alsoAllow: s.alwaysAllow ?? [] }) });
  const mcpConfigFile = writeRuntimeFile(`chat-${s.id}.mcp.json`, { mcpServers: { orchestra: {
    type: 'stdio', command: process.execPath, args: [join(here, 'approve-mcp.mjs')],
    env: { ORCHESTRA_URL: ORIGIN, ORCHESTRA_TOKEN: TOKEN, ORCHESTRA_CHAT: s.id } } } });
  const command = chatCommand({ mode, settingsFile, mcpConfigFile });
  const turn = { child: null, stopped: false };
  chats.set(s.id, turn);
  const { child, done } = runChat({ cwd, prompt, command, onEvent: ev => broadcast({ type: 'chat', id: s.id, ...ev }) });
  turn.child = child;
  broadcast({ type: 'chat', id: s.id, kind: 'start' });
  done.then(r => {
    chats.delete(s.id);
    for (const a of pendingFor(s.id)) answerApproval(a.id, false, 'The chat turn ended.');
    const parsed = parseRunBlock(r.text, { skills: listSkills().map(k => k.name) });
    const msg = { role: 'assistant', text: parsed.text, at: Date.now() };
    if (turn.stopped) msg.note = 'Stopped.';
    else if (r.error) msg.error = r.error;
    else if (parsed.error) msg.error = parsed.error;
    s.messages.push(msg);
    if (parsed.run && !turn.stopped && !r.error) {
      try {
        const project = s.project ?? parsed.run.project;
        startRun({ job: parsed.run.brief, project, flow: parsed.run.flow, skills: parsed.run.skills, steps: parsed.run.steps, sessionId: s.id });
        s.project = project;
      } catch (e) { msg.error = `Build not started: ${e.message}`; }
    }
    saveSession(s);
    broadcast({ type: 'chat', id: s.id, kind: 'done' });
  });
}

// ---------- HTTP ----------
const readBody = (req) => new Promise((ok, fail) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
  req.on('end', () => ok(b));
  req.on('error', fail);
});

function serveFile(res, root, rel) {
  const file = inside(root, rel);
  const st = file && statSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const p = url.pathname;
  // The approval server is a local process, not a page: it proves itself with the per-start token.
  const internal = p === '/internal/approve' && req.headers['x-orchestra-token'] === TOKEN;
  if (req.method === 'POST' && !internal && !isAllowedOrigin(req.headers.origin)) return send(403, { error: 'Forbidden origin' });
  try {
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : null;
    if (internal) return send(200, await requestApproval(body));
    if (req.method === 'GET' && p === '/') return send(200, readFileSync(join(here, 'ui.html')), TYPES['.html']);
    if (p === '/api/config') return send(200, { ...config, previewPort: PREVIEW_PORT });
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      for (const ev of run?.events ?? []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // Skills
    if (req.method === 'GET' && p === '/api/skills') return send(200, listSkills());
    if (req.method === 'POST' && p === '/api/skills') {
      const file = join(skillsDir, `${skillName(body.name)}.md`);
      if (body.delete) rmSync(file, { force: true });
      else {
        if (!body.content?.trim()) return send(400, { error: 'Write what the skill should teach the agents.' });
        mkdirSync(skillsDir, { recursive: true });
        writeFileSync(file, body.content.trim() + '\n');
      }
      return send(200, { ok: true, name: skillName(body.name) });
    }

    // Chats
    if (req.method === 'GET' && p === '/api/sessions') return send(200, listSessions());
    if (req.method === 'POST' && p === '/api/sessions') return send(200, newSession(body.project || null));
    if (req.method === 'GET' && p === '/api/session') {
      const s = loadSession(url.searchParams.get('id'));
      return send(200, { ...s, mode: MODES[s.mode] ? s.mode : 'ask', replying: chats.has(s.id), approvals: pendingFor(s.id) });
    }
    if (req.method === 'POST' && p === '/api/session') {
      const s = loadSession(body.id);
      if (body.delete) {
        if (chats.has(s.id) || (run?.running && run.sessionId === s.id)) return send(409, { error: 'This chat is busy. Stop it first.' });
        rmSync(join(sessionsDir, `${s.id}.json`), { force: true }); cache.delete(s.id);
        broadcast({ type: 'session', id: s.id, deleted: true });
        return send(200, { ok: true });
      }
      if ('project' in body) { if (body.project) projectPath(body.project); s.project = body.project || null; }
      if ('mode' in body) { if (!MODES[body.mode]) return send(400, { error: 'Unknown mode.' }); s.mode = body.mode; }
      if (body.forget) s.alwaysAllow = [];
      saveSession(s);
      return send(200, s);
    }
    if (req.method === 'POST' && p === '/api/approve') {
      const a = approvals.get(body.id);
      if (!a) return send(404, { error: 'That request has already been answered.' });
      if (body.allow && body.always) {
        const s = loadSession(a.chat);
        s.alwaysAllow = [...new Set([...(s.alwaysAllow ?? []), a.tool])];
        saveSession(s);
      }
      answerApproval(body.id, !!body.allow);
      return send(200, { ok: true });
    }

    // Connectors
    if (req.method === 'GET' && p === '/api/connectors') return send(200, connectorList());
    if (req.method === 'POST' && p === '/api/connectors') {
      const s = loadSettings();
      const c = s.connectors ?? {};
      const off = new Set(c.disabled ?? []);
      body.enabled ? off.delete(body.name) : off.add(body.name);
      s.connectors = { ...c, disabled: [...off] };
      saveSettings(s);
      broadcast({ type: 'connectors' });
      return send(200, connectorList());
    }
    if (req.method === 'POST' && p === '/api/connectors/refresh') { refreshConnectors(); return send(200, { ok: true }); }
    if (req.method === 'POST' && p === '/api/connectors/signin') {
      // Sign-in for MCP servers happens in Claude Code itself: open it in a new console window.
      if (process.platform === 'win32') exec('start "Claude Code - type /mcp to sign in to connectors" cmd /k claude.cmd', { cwd: here });
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/chat') {
      const text = String(body.text ?? '').trim();
      if (!text) return send(400, { error: 'Type a message first.' });
      chatTurn(loadSession(body.id), text);
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/chat/stop') {
      const t = chats.get(body.id);
      if (t) { t.stopped = true; for (const a of pendingFor(body.id)) answerApproval(a.id, false, 'Stopped by the user.'); killTree(t.child); }
      return send(200, { ok: true });
    }

    // Builds
    if (req.method === 'POST' && p === '/api/run') {
      if (!body.job?.trim()) return send(400, { error: 'Describe the job first.' });
      startRun({ ...body, job: body.job.trim() });
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/stop') {
      if (run?.running) { run.stopped = true; killTree(run.child); }
      return send(200, { ok: true });
    }

    // Projects and files
    if (req.method === 'GET' && p === '/api/projects') return send(200, listProjects());
    if (req.method === 'GET' && p === '/api/tree') {
      const dir = projectPath(url.searchParams.get('project'));
      return send(200, existsSync(dir) ? listDir(dir, url.searchParams.get('dir') || '') : []);
    }
    if (req.method === 'POST' && p === '/api/mkdir') {
      const dir = inside(projectPath(body.project), String(body.path ?? ''));
      if (!dir) return send(400, { error: 'That path is outside the project.' });
      mkdirSync(dir, { recursive: true });
      broadcast({ type: 'files', project: body.project });
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/file') {
      const file = inside(projectPath(body.project), String(body.path ?? ''));
      if (!file) return send(400, { error: 'That path is outside the project.' });
      if (typeof body.content !== 'string') return send(400, { error: 'Nothing to save.' });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body.content);
      broadcast({ type: 'files', project: body.project });
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/open-folder') {
      const dir = body.project ? projectPath(body.project) : run?.dir;
      if (dir) execFile('explorer', [dir]);
      return send(200, { ok: true });
    }
    if (req.method === 'GET' && p.startsWith('/p/')) {
      const [name, ...rest] = p.slice(3).split('/').map(decodeURIComponent);
      // Project files are untrusted: sandboxed, an opened HTML/SVG can't run as the app and call its API.
      res.setHeader('Content-Security-Policy', 'sandbox');
      return serveFile(res, projectPath(name), rest.join('/'));
    }
    send(404, { error: 'Not found' });
  } catch (e) {
    send(400, { error: e.message });
  }
});

// Preview: read-only project files on their own origin. /<project>/ serves index.html.
const preview = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const parts = new URL(req.url, 'http://x').pathname.slice(1).split('/').map(decodeURIComponent);
    const [name, ...rest] = parts;
    serveFile(res, projectPath(name), rest.join('/') || 'index.html');
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preview.listen(PREVIEW_PORT, '127.0.0.1');
  refreshConnectors(); // takes a while; the list updates in the app when it's done
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Orchestra is running at ${ORIGIN}  (keep this window open; close it to stop)`);
    if (process.platform === 'win32' && !process.argv.includes('--no-open'))
      exec(`start "" msedge --app=${ORIGIN}`, err => err && console.log('Could not open Edge. Open the address above in your browser.'));
  });
}
