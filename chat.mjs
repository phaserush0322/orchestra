// Chat: a conversation with the chat agent (Sonnet by default, see "chat" in flows.json).
// The chat agent has Claude Code's full toolset and the enabled connectors. Depending on the chat's
// mode, risky actions wait for the user's Allow in the app (through approve-mcp.mjs).
// For bigger jobs it ends its reply with an <orchestra-run> block, which the server turns into a build.
import { spawn } from 'node:child_process';
import { config, checkSteps } from './orchestra.mjs';

export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

// ask: commands, edits and anything risky wait for Allow. edits: file edits are automatic, commands ask.
// full: everything runs without asking. Full access is done by the app's approval hook answering "allow"
// itself (not the CLI's bypass mode), so publishing tools can still be held for the user.
export const MODES = { ask: 'manual', edits: 'acceptEdits', full: 'acceptEdits' };

export function chatCommand({ mode = 'ask', settingsFile, mcpConfigFile } = {}, agent = config.agents[config.chat?.agent ?? 'sonnet']) {
  if (!agent || agent.cli !== 'claude') throw new Error('The chat agent must use the claude CLI (see "chat" in flows.json).');
  // Nothing saved by the CLI: the server keeps the history itself.
  return `claude -p --model ${agent.model} --output-format stream-json --verbose --include-partial-messages --no-session-persistence ` +
         `--permission-mode ${MODES[mode] ?? MODES.ask}` +
         (mcpConfigFile ? ` --mcp-config "${mcpConfigFile}" --permission-prompt-tool mcp__orchestra__approve` : '') +
         (settingsFile ? ` --settings "${settingsFile}"` : '');
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
  let steps = null;
  if (raw.steps != null) {
    try { steps = checkSteps(raw.steps); }
    catch (e) { return { text: clean, run: null, error: `The build request's steps were not valid (${e.message}), so nothing was started.` }; }
  }
  const flow = flows[raw.flow] ? raw.flow
    : steps ? 'custom'
    : (Object.keys(flows).find(n => flows[n].match?.some(w => brief.toLowerCase().includes(w))) ?? 'default');
  const known = new Set(skills);
  const picked = (Array.isArray(raw.skills) ? raw.skills : []).map(String).filter(s => known.has(s));
  return { text: clean, run: { brief, flow, skills: picked, project: slug(raw.project) || slug(brief).slice(0, 30) || 'project', ...(steps && { steps }) } };
}

// What the chat agent knows each turn: its job, the team, the project, and the conversation so far.
export function chatPrompt({ message, history = [], project = null, files = [], projects = [], skills = [], running = [], mode = 'ask', connectors = [], cwd = '' }) {
  const flows = Object.entries(config.flows).map(([n, f]) =>
    `- ${n}: ${f.about ?? ''} Steps: ${f.steps.map(s => `${s.name} (${s.agent}, ${config.agents[s.agent]?.model})`).join(' -> ')}`).join('\n');
  const agents = Object.entries(config.agents).filter(([n]) => n !== (config.chat?.agent ?? 'sonnet'))
    .map(([n, a]) => `- ${n} (${a.model}): ${a.about ?? ''}`).join('\n');
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
- You are a full assistant with Claude Code's tools on the user's Windows computer: read, write, move and delete files in any folder, run shell commands (PowerShell or Bash), install packages, use git (commit, push), search the web, and use the connectors listed below. Do what the user asks directly, the way a capable engineer would, and report what you did.
- Reply in the user's language (they may mix English and Tagalog). Keep replies short and clear; use Markdown.
- Permission mode for this chat: ${{ ask: 'ASK FIRST: commands, file changes and other risky actions show the user an Allow/Deny card and wait for them', edits: 'AUTO-ACCEPT EDITS: file edits run directly; commands show the user an Allow/Deny card', full: 'FULL ACCESS: your actions run without asking' }[mode] ?? 'ASK FIRST'}. If the user denies something, do not try to get around it; ask what they want instead.
- Before anything destructive or hard to undo (deleting files, force-pushing, overwriting work), say what you are about to do. Publish to the public (for example Astrocade publish_game) only when the user explicitly asks for it in this chat.
- Questions, file and git work, and tiny one-line edits: do them yourself. Real work on a project goes to the build team. Reviews (security or code), tests and images are never yours, even on a small project: always hand them to the specialist agent below, without reading the code first. Analyze each request and send it through the shortest process that does it well:
  1. NEW project or a BIG feature that needs design decisions: the full preset flow that fits (the flow list below), without "steps".
  2. A preset that almost fits: the preset flow plus a "steps" list with steps added or removed for this project. Say in your reply what you changed and why.
  3. A FOLLOW-UP on an existing project: only the step(s) it needs, sent straight to the right agent, skipping planning and anything else not needed. Examples:
     - a specific tweak (this color, this text, this animation, a bug): [{"name":"code","agent":"opus",...}]
     - a redesign, a new look or feel, "make it look better / more premium", UX problems, a new page or screen: [{"name":"design","agent":"designer",...},{"name":"code","agent":"opus",...}] (the designer updates DESIGN.md, the developer applies it)
     - a security review: [{"name":"security","agent":"astra",...}]; a code review or tests: sol
     - new or better images, a thumbnail, icons: astra
     - a change that touches many parts or needs design decisions (a new system, a big rework): add a "plan" step (fable) first, then code
     Add a review step after code only when the change is risky (logins, payments, data) or the user asks for it.
- To hand work to the build team: say in one or two sentences what you are handing off and which steps will run, then end your reply with exactly one block like this (not inside a code fence):
<orchestra-run>
{"project": "short-kebab-name", "flow": "game", "skills": ["web-game"], "brief": "...", "steps": [{"name": "code", "agent": "opus", "task": "..."}]}
</orchestra-run>
  - brief: a complete, self-contained job, in English. Include every requirement and decision from the conversation. For an existing project, say exactly what to change and what must stay the same.
  - flow: the preset flow that fits best (list below), or "custom" for a follow-up made only of your own steps.
  - steps: leave it out to run the preset's own steps. Otherwise 1 to 8 steps, in order; each has a short name, an agent from THE AGENTS list, and a task telling that agent its role and exactly what to do (it also sees the brief). Steps hand work to each other through files in the project folder.
  - skills: the skills below that fit this job; [] if none fit.
  - project: for a new project, a new short folder name not in the existing list. To work on an existing project, use its exact name. Ignored when this chat already has a project.
- Only start a build when the user clearly wants the work done. If they are asking, exploring, or you need an answer first (for example their own rules say to wait for their "go"), just reply and ask.
- Builds in different projects run at the same time, but only one per project: if a build is already running in this chat's project, do not start another there; tell them to wait or press Stop.

THE BUILD TEAM: preset flows
${flows}

THE AGENTS (for "steps")
${agents}

SKILLS
${skillList}

CONNECTORS (MCP servers you can use; their tools are named mcp__<server>__<tool>. If a tool isn't loaded yet, find it with ToolSearch)
${connectors.length ? connectors.map(c => `- ${c}`).join('\n') : '(none enabled)'}

WORKING FOLDER: ${cwd}
THIS CHAT'S PROJECT: ${project ? `"${project}"` : 'none yet (a build will create one)'}
${project ? `Files: ${files.slice(0, 80).join(', ') || '(empty)'}${files.length > 80 ? ` and ${files.length - 80} more` : ''}` : `Existing projects: ${projects.join(', ') || '(none)'}`}
BUILDS RUNNING NOW: ${running.length ? running.map(p => `"${p}"`).join(', ') : 'none'}

CONVERSATION SO FAR
${transcript || '(this is the first message)'}

USER'S NEW MESSAGE
${message}`;
}

// One short line describing a tool call, for the chat ("Bash git push", "Edit src/main.js").
export function toolSummary(name, input = {}) {
  const i = input ?? {};
  const short = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 140);
  const target = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.path ?? i.url ?? i.query ?? '';
  const pretty = String(name).replace(/^mcp__([^_]+(?:_[^_]+)*?)__/, (_, s) => `${s.replace(/^claude_ai_/, '')}: `);
  const shown = i.command ? short(target) : String(target).split(/[\\/]/).slice(-2).join('/');
  return `${pretty} ${short(shown)}`.trim();
}

// Runs one chat turn. Streams events to onEvent: {kind:'delta', text} | {kind:'tool', text}.
// Returns { child, done } where done resolves to { ok, text, error }.
export function runChat({ cwd, prompt, onEvent, command = chatCommand() }) {
  const child = spawn(command, { shell: true, cwd });
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
        onEvent({ kind: 'tool', text: toolSummary(c.name, c.input) });
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
