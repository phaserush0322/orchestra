// Chat: a conversation with the chat agent (Sonnet by default, see "chat" in flows.json).
// The chat agent can read the project but not change it. When the user wants work done, it ends its
// reply with an <orchestra-run> block; the server turns that into a build (flow + skills + brief).
import { spawn } from 'node:child_process';
import { config } from './orchestra.mjs';

export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export function chatCommand(agent = config.agents[config.chat?.agent ?? 'sonnet']) {
  if (!agent || agent.cli !== 'claude') throw new Error('The chat agent must use the claude CLI (see "chat" in flows.json).');
  // Read-only tools, no MCP servers (faster start), nothing saved: the server keeps the history itself.
  return `claude -p --model ${agent.model} --output-format stream-json --verbose --include-partial-messages ` +
         `--tools Read,Glob,Grep --strict-mcp-config --no-session-persistence`;
}

const RUN_RE = /<orchestra-run>\s*([\s\S]*?)\s*<\/orchestra-run>/;

// Splits a finished reply into the text the user sees and the build request, if any.
export function parseRunBlock(text, { flows = config.flows, skills = [] } = {}) {
  const m = String(text).match(RUN_RE);
  if (!m) return { text: String(text).trim(), run: null };
  const clean = String(text).replace(RUN_RE, '').trim();
  let raw;
  try { raw = JSON.parse(m[1].replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { return { text: clean, run: null, error: 'The build request was not valid JSON, so nothing was started.' }; }
  const brief = String(raw.brief ?? '').trim();
  if (!brief) return { text: clean, run: null, error: 'The build request had no brief, so nothing was started.' };
  const flow = flows[raw.flow] ? raw.flow : (Object.keys(flows).find(n => flows[n].match?.some(w => brief.toLowerCase().includes(w))) ?? 'default');
  const known = new Set(skills);
  const picked = (Array.isArray(raw.skills) ? raw.skills : []).map(String).filter(s => known.has(s));
  return { text: clean, run: { brief, flow, skills: picked, project: slug(raw.project) || slug(brief).slice(0, 30) || 'project' } };
}

// What the chat agent knows each turn: its job, the team, the project, and the conversation so far.
export function chatPrompt({ message, history = [], project = null, files = [], projects = [], skills = [], running = null }) {
  const flows = Object.entries(config.flows).map(([n, f]) =>
    `- ${n}: ${f.about ?? ''} Steps: ${f.steps.map(s => `${s.name} (${s.agent}, ${config.agents[s.agent]?.model})`).join(' -> ')}`).join('\n');
  const skillList = skills.length
    ? skills.map(s => `- ${s.name}: ${s.content.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 160) ?? ''}`).join('\n')
    : '(none)';
  const transcript = history.slice(-30).map(m => {
    if (m.role === 'user') return `USER: ${m.text}`;
    if (m.role === 'assistant') return `YOU: ${m.text}`;
    if (m.role === 'build') return `[BUILD ${m.status.toUpperCase()}: flow "${m.flow}", project "${m.project}"${m.files ? `, files: ${m.files.join(', ')}` : ''}. Brief: ${m.brief.slice(0, 400)}]`;
    return '';
  }).filter(Boolean).join('\n\n').slice(-40000);

  return `You are the assistant inside Orchestra, an app where the user chats with you and a team of AI agents builds software for them.

HOW YOU WORK
- Chat like a normal assistant: answer questions, explain code, suggest ideas, help the user decide. Reply in the user's language (they may mix English and Tagalog). Keep replies short and clear; use Markdown.
- You can read the project's files with Read, Glob and Grep (your working folder is the project). You cannot edit files or run commands. Never claim you changed something yourself.
- When the user wants something built, created, changed or fixed now, hand it to the build team: say in one or two sentences what you are handing off, then end your reply with exactly one block like this (not inside a code fence):
<orchestra-run>
{"project": "short-kebab-name", "flow": "game", "skills": ["web-game"], "brief": "..."}
</orchestra-run>
  - brief: a complete, self-contained job for the planner, in English. Include every requirement and decision from the conversation. For an existing project, say exactly what to change and what must stay the same.
  - flow: the best flow for the job (list below).
  - skills: the skills below that fit this job; [] if none fit.
  - project: for a new project, a new short folder name not in the existing list. To work on an existing project, use its exact name. Ignored when this chat already has a project.
- Only start a build when the user clearly wants the work done. If they are asking, exploring, or you need an answer first (for example their own rules say to wait for their "go"), just reply and ask.
- If a build is already running, do not start another one; tell them to wait or press Stop.

THE BUILD TEAM (flows)
${flows}

SKILLS
${skillList}

THIS CHAT'S PROJECT: ${project ? `"${project}"` : 'none yet (a build will create one)'}
${project ? `Files: ${files.slice(0, 80).join(', ') || '(empty)'}${files.length > 80 ? ` and ${files.length - 80} more` : ''}` : `Existing projects: ${projects.join(', ') || '(none)'}`}
BUILD STATUS: ${running ? `running "${running}"` : 'idle'}

CONVERSATION SO FAR
${transcript || '(this is the first message)'}

USER'S NEW MESSAGE
${message}`;
}

// Runs one chat turn. Streams events to onEvent: {kind:'delta', text} | {kind:'tool', text}.
// Returns { child, done } where done resolves to { ok, text, error }.
export function runChat({ cwd, prompt, onEvent }) {
  const child = spawn(chatCommand(), { shell: true, cwd });
  let buf = '', full = '', error = '', stderr = '';
  const add = (t) => { full += t; onEvent({ kind: 'delta', text: t }); };
  const handle = (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'stream_event') {
      const e = m.event;
      if (e.type === 'content_block_start' && e.content_block?.type === 'text' && full.trim()) add('\n\n');
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') add(e.delta.text);
    } else if (m.type === 'assistant') {
      for (const c of m.message?.content ?? []) if (c.type === 'tool_use') {
        const i = c.input ?? {};
        const target = i.file_path ?? i.pattern ?? i.path ?? '';
        onEvent({ kind: 'tool', text: `${c.name} ${String(target).split(/[\\/]/).slice(-2).join('/')}`.trim() });
      }
    } else if (m.type === 'result' && m.is_error) {
      error = String(m.result || m.subtype || 'The chat agent failed.');
    }
  };
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  });
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  child.stdin.end(prompt);
  const done = new Promise(res => {
    child.on('error', e => res({ ok: false, text: full, error: e.message }));
    child.on('close', code => {
      if (buf.trim()) handle(buf.trim());
      if (code !== 0 && !error) error = stderr.trim().split('\n').slice(-3).join('\n') || `The chat agent stopped (exit ${code}).`;
      res({ ok: !error, text: full, error });
    });
  });
  return { child, done };
}
