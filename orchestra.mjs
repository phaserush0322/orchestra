#!/usr/bin/env node
// Orchestra: runs a job through a flow of steps, each step on its assigned agent + model.
// Steps hand work to each other through files in the project folder (e.g. PLAN.md).
// Usage: node orchestra.mjs "make a snake game" --dir ./snake [--flow game] [--from code] [--skills a,b] [--dry]
// Project rules are read from <dir>/RULES.md automatically.
// The desktop UI (server.mjs) uses the same functions.
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const config = JSON.parse(readFileSync(resolve(here, 'flows.json'), 'utf8'));

// ---------- Local settings (settings.json, not in git) and connector permissions ----------
// runtimeDir holds per-run files the claude CLI reads (permission rules, MCP config). Not in git.
export const runtimeDir = resolve(here, '.orchestra');
const settingsFile = resolve(here, 'settings.json');
export function loadSettings() { try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch { return {}; } }
export function saveSettings(s) { writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n'); }

// Claude Code names MCP tools mcp__<server>__<tool>; a rule of just mcp__<server> covers the whole server.
export const mcpKey = (name) => 'mcp__' + String(name).replace(/[^A-Za-z0-9_-]/g, '_');
// Tools that publish or post publicly: build agents may never use them, and in chat they always ask first.
export const PUBLISH_TOOLS = ['mcp__claude_ai_Astrocade__publish_game'];

// Permission rules for the claude CLI: enabled connectors are allowed, switched-off ones denied.
export function permissionRules({ forAgents = false, alsoAllow = [] } = {}) {
  const c = loadSettings().connectors ?? {};
  const off = new Set(c.disabled ?? []);
  const servers = c.servers ?? [];
  const allow = [...servers.filter(s => !off.has(s.name)).map(s => mcpKey(s.name)), ...alsoAllow];
  const deny = servers.filter(s => off.has(s.name)).map(s => mcpKey(s.name));
  return forAgents ? { allow, deny: [...deny, ...PUBLISH_TOOLS] } : { allow, deny, ask: PUBLISH_TOOLS };
}
export function writeRuntimeFile(name, data) {
  mkdirSync(runtimeDir, { recursive: true });
  const file = join(runtimeDir, name);
  // Parallel builds rewrite the same file: write aside, then swap in, so the CLI never reads half a file.
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
  return file;
}

export function pickFlow(job, flowName) {
  if (flowName) {
    if (!config.flows[flowName]) throw new Error(`No flow named "${flowName}" in flows.json`);
    return flowName;
  }
  const text = job.toLowerCase();
  return Object.keys(config.flows).find(n => config.flows[n].match?.some(w => text.includes(w))) ?? 'default';
}

// Prompt goes in via stdin, so only config tokens (models, flags) appear on the command line.
// Claude build agents get the enabled connectors (never publishing) through a settings file.
export function command(agent) {
  if (agent.cli === 'claude') {
    const rules = writeRuntimeFile('agent-settings.json', { permissions: permissionRules({ forAgents: true }) });
    return `claude -p --model ${agent.model} --permission-mode ${agent.permissionMode ?? 'acceptEdits'} --settings "${rules}"`;
  }
  if (agent.cli === 'codex')
    return `codex exec -m ${agent.model} -s workspace-write --skip-git-repo-check ${(agent.args ?? []).join(' ')} -`;
  throw new Error(`Unknown cli "${agent.cli}" (use claude or codex)`);
}

// Skills: reusable guidance files in skills/<name>.md, picked per run.
// Rules: per-project guidance in <project>/RULES.md, applied to every run in that folder.
export const skillsDir = resolve(here, 'skills');

export function skillName(name) {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!s) throw new Error('Give the skill a name (letters and numbers).');
  return s;
}

export function listSkills() {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir).filter(f => f.endsWith('.md'))
    .map(f => ({ name: f.slice(0, -3), content: readFileSync(join(skillsDir, f), 'utf8') }));
}

export function guidance(dir, names = []) {
  const skills = names.map(n => {
    const file = join(skillsDir, `${skillName(n)}.md`);
    if (!existsSync(file)) throw new Error(`No skill named "${n}" in skills/`);
    return { name: skillName(n), content: readFileSync(file, 'utf8').trim() };
  });
  const rulesFile = join(dir, 'RULES.md');
  const rules = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8').trim() : '';
  return { rules, skills };
}

export function prompt(job, step, { rules = '', skills = [] } = {}) {
  let p = `JOB: ${job}\n\nYOUR ROLE IN THIS PIPELINE (step "${step.name}"): ${step.task}`;
  if (rules) p += `\n\nPROJECT RULES (you must follow these; they override your defaults):\n${rules}`;
  for (const s of skills) p += `\n\nSKILL "${s.name}" (apply it where it fits your role):\n${s.content}`;
  return `${p}\n\nWork only inside the current folder.`;
}

// A step list written by the chat agent: 1-8 steps, known agents only, a unique name and a task each.
export function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 8) throw new Error('A custom flow needs 1 to 8 steps.');
  const seen = new Set();
  return steps.map(s => {
    const name = String(s?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    const task = String(s?.task ?? '').trim();
    if (!name || seen.has(name)) throw new Error(`Every step needs its own name (got "${s?.name ?? ''}").`);
    if (!Object.hasOwn(config.agents, String(s.agent))) throw new Error(`Step "${name}" uses unknown agent "${s.agent}".`);
    if (!task) throw new Error(`Step "${name}" has no task.`);
    seen.add(name);
    return { name, agent: String(s.agent), task: task.slice(0, 4000) };
  });
}

// customSteps (from the chat) replace the flow's own steps; the flow name is kept as a label.
export function planRun(job, flowName, from, customSteps) {
  const flow = customSteps ? (config.flows[flowName] ? flowName : 'custom') : pickFlow(job, flowName);
  let steps = customSteps ? checkSteps(customSteps) : config.flows[flow].steps;
  if (from) {
    const i = steps.findIndex(s => s.name === from);
    if (i < 0) throw new Error(`No step "${from}" in flow "${flow}"`);
    steps = steps.slice(i);
  }
  for (const s of steps) if (!config.agents[s.agent]) throw new Error(`Step "${s.name}" uses unknown agent "${s.agent}"`);
  return { flow, steps };
}

// Stops a running agent and everything it started (the shell wraps the CLI, so kill the whole tree).
export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGTERM');
}

// Runs one step; streams the agent's output to onData; resolves with the exit code.
// onChild receives the process so the caller can stop it.
export function runStep(step, job, dir, onData, extra, onChild) {
  return new Promise(done => {
    const p = spawn(command(config.agents[step.agent]), { shell: true, cwd: dir });
    onChild?.(p);
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', e => { onData(`\n${e.message}\n`); done(1); });
    p.on('close', code => done(code ?? 1));
    p.stdin.end(prompt(job, step, extra));
  });
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const dry = argv.includes('--dry') && argv.splice(argv.indexOf('--dry'), 1);
  const dir = resolve(opt('--dir') ?? 'project');
  const flowName = opt('--flow');
  const from = opt('--from');
  const skillNames = opt('--skills')?.split(',').filter(Boolean) ?? [];
  const job = argv.join(' ').trim();
  if (!job) { console.error('Usage: node orchestra.mjs "<job>" --dir <folder> [--flow name] [--from step] [--skills a,b] [--dry]'); process.exit(1); }

  const { flow, steps } = planRun(job, flowName, from);
  const extra = guidance(dir, skillNames);
  console.log(`\nFlow: ${flow}  |  Folder: ${dir}`);
  console.log(`Skills: ${extra.skills.map(s => s.name).join(', ') || 'none'}  |  Project rules: ${extra.rules ? 'RULES.md' : 'none'}\n`);
  if (!dry) mkdirSync(dir, { recursive: true });

  for (const step of steps) {
    const agent = config.agents[step.agent];
    console.log(`=== [${step.name}] -> ${step.agent} (${agent.model}) ===`);
    if (dry) { console.log(`  $ ${command(agent)}\n`); continue; }
    const code = await runStep(step, job, dir, d => process.stdout.write(d), extra);
    if (code !== 0) {
      console.error(`\nStep "${step.name}" failed (exit ${code}). Fix it, then resume with: --from ${step.name}`);
      process.exit(1);
    }
  }
  console.log(`\nDone. Output is in ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
