import assert from 'node:assert/strict';
import { config, pickFlow, command, planRun, prompt, skillName, guidance } from './orchestra.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Skills and rules reach the agents' prompts; skill names can't escape the skills folder.
assert.equal(skillName('../../Evil Skill!'), 'evil-skill');
assert.throws(() => skillName('../'));
const tmp = mkdtempSync(join(tmpdir(), 'orch-'));
writeFileSync(join(tmp, 'RULES.md'), 'Use TypeScript only.');
const g = guidance(tmp, ['web-game']);
assert.equal(g.rules, 'Use TypeScript only.');
assert.equal(g.skills[0].name, 'web-game');
assert.throws(() => guidance(tmp, ['no-such-skill']));
const p = prompt('job', { name: 'code', task: 'build' }, g);
assert.ok(p.includes('PROJECT RULES') && p.includes('Use TypeScript only.') && p.includes('SKILL "web-game"'));
assert.ok(!prompt('job', { name: 'code', task: 'build' }).includes('PROJECT RULES'));
rmSync(tmp, { recursive: true });
import { isAllowedOrigin, projectDir } from './server.mjs';

assert.deepEqual(planRun('make a game', undefined, 'code').steps.map(s => s.name), ['code', 'review', 'thumbnail']);
assert.throws(() => planRun('make a game', undefined, 'nope'));
assert.ok(isAllowedOrigin('http://127.0.0.1:4545'));
assert.ok(!isAllowedOrigin('https://evil.example'));
assert.ok(!isAllowedOrigin(undefined));
assert.match(projectDir('Make a Snake Game!', ''), /projects[\\/]make-a-snake-game$/);
assert.equal(projectDir('x', 'C:\\Games\\snake'), 'C:\\Games\\snake');

assert.equal(pickFlow('Make a snake GAME'), 'game');
assert.equal(pickFlow('build a todo app'), 'default');
assert.equal(pickFlow('build a todo app', 'game'), 'game');
assert.throws(() => pickFlow('x', 'nope'));
assert.match(command(config.agents.fable), /^claude -p --model claude-fable-5-2 /);
assert.match(command(config.agents.astra), /^codex exec -m gpt-6\.2-astra .* -$/);
for (const [name, flow] of Object.entries(config.flows))
  for (const s of flow.steps) assert.ok(config.agents[s.agent], `${name}/${s.name} uses unknown agent ${s.agent}`);
// Chat: the build request is pulled out of the reply and checked against real flows and skills.
import { parseRunBlock, chatPrompt, chatCommand, toolSummary } from './chat.mjs';
import { inside, projectPath, parseMcpList } from './server.mjs';
import { mcpKey, PUBLISH_TOOLS, checkSteps } from './orchestra.mjs';

// Connectors: parsed from "claude mcp list"; rule names match how Claude Code names MCP tools.
const mcp = parseMcpList([
  'Checking MCP server health…', '',
  'claude.ai Astrocade: https://mcp.astrocade.com/mcp - ✔ Connected',
  'plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication',
  'plugin:design:gmail:  (HTTP) - - Not configured',
  'blender: C:\\uvx.exe mcp-for-blender - ✘ Failed to connect — CONNECTION_CLOSED',
].join('\n'));
assert.deepEqual(mcp.map(m => [m.name, m.status, m.source]), [
  ['claude.ai Astrocade', 'connected', 'claude.ai'], ['plugin:design:slack', 'needs-auth', 'plugin'],
  ['plugin:design:gmail', 'not-configured', 'plugin'], ['blender', 'failed', 'local']]);
assert.equal(mcpKey('claude.ai Astrocade'), 'mcp__claude_ai_Astrocade');
assert.equal(mcpKey('plugin:parallax-threejs:playwright-mcp'), 'mcp__plugin_parallax-threejs_playwright-mcp');
assert.ok(PUBLISH_TOOLS[0].startsWith(mcpKey('claude.ai Astrocade') + '__'));
const reply = 'On it.\n<orchestra-run>\n{"project":"Neon Snake!","flow":"game","skills":["web-game","made-up"],"brief":"Build a snake game"}\n</orchestra-run>';
const pr = parseRunBlock(reply, { skills: ['web-game'] });
assert.equal(pr.text, 'On it.');
assert.deepEqual(pr.run, { brief: 'Build a snake game', flow: 'game', skills: ['web-game'], project: 'neon-snake' });
assert.equal(parseRunBlock('Just an answer.').run, null);
assert.equal(parseRunBlock('x <orchestra-run>{"brief":"make a todo app","flow":"nope"}</orchestra-run>').run.flow, 'default');
assert.ok(parseRunBlock('x <orchestra-run>not json</orchestra-run>').error);
assert.ok(parseRunBlock('x <orchestra-run>{"flow":"game"}</orchestra-run>').error);
// Flow per project type (terminal keywords; the chat picks by description).
assert.equal(pickFlow('build an e-commerce website for shoes'), 'webapp');
assert.equal(pickFlow('make a portfolio website'), 'website');
assert.equal(pickFlow('a backend for orders'), 'system');
// Custom steps: Sonnet can send a follow-up straight to one agent, skipping plan and code.
const direct = parseRunBlock('Sending it to Astra. <orchestra-run>{"flow":"custom","brief":"Security review of the checkout","steps":[{"name":"Security Review","agent":"astra","task":"Review the checkout"}]}</orchestra-run>');
assert.equal(direct.run.flow, 'custom');
assert.deepEqual(direct.run.steps, [{ name: 'security-review', agent: 'astra', task: 'Review the checkout' }]);
assert.deepEqual(planRun('x', 'custom', undefined, direct.run.steps).steps.map(s => s.agent), ['astra']);
const tweak = planRun('x', 'webapp', 'code', [{ name: 'plan', agent: 'fable', task: 'p' }, { name: 'code', agent: 'opus', task: 'c' }]);
assert.deepEqual([tweak.flow, tweak.steps.map(s => s.name)], ['webapp', ['code']], 'preset label kept, retry from a custom step');
assert.ok(parseRunBlock('x <orchestra-run>{"brief":"b","steps":[{"name":"a","agent":"hacker","task":"t"}]}</orchestra-run>').error, 'unknown agent rejected');
assert.ok(parseRunBlock('x <orchestra-run>{"brief":"b","steps":[{"name":"a","agent":"toString","task":"t"}]}</orchestra-run>').error, 'prototype names are not agents');
assert.throws(() => checkSteps([{ name: 'a', agent: 'opus', task: 't' }, { name: 'A', agent: 'sol', task: 't' }]), /own name/);
assert.throws(() => checkSteps([{ name: 'a', agent: 'opus', task: ' ' }]), /no task/);
assert.throws(() => checkSteps(Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, agent: 'opus', task: 't' }))), /1 to 8/);
assert.throws(() => checkSteps([]), /1 to 8/);
assert.ok(chatPrompt({ message: 'hi' }).includes('- astra (gpt-6.2-astra)'), 'Sonnet sees the agents');

// Chat modes map to CLI permission modes; Ask first routes prompts to the app.
assert.match(chatCommand(), /^claude -p --model claude-sonnet-5-5 .*--permission-mode manual/);
assert.ok(!/bypassPermissions/.test(chatCommand({ mode: 'full' })), 'full access goes through the app so publishing can still ask');
assert.match(chatCommand({ mode: 'edits', mcpConfigFile: 'C:\\x\\m.json', settingsFile: 'C:\\x\\s.json' }),
  /--permission-mode acceptEdits --mcp-config "C:\\x\\m.json" --permission-prompt-tool mcp__orchestra__approve --settings "C:\\x\\s.json"/);
assert.ok(!/strict-mcp-config|--tools /.test(chatCommand()), 'the chat gets all tools and MCP servers');
assert.equal(toolSummary('Bash', { command: 'git   push origin main' }), 'Bash git push origin main');
assert.equal(toolSummary('mcp__claude_ai_Astrocade__list_my_games', {}), 'Astrocade: list_my_games');
assert.ok(chatPrompt({ message: 'hi', history: [{ role: 'user', text: 'earlier' }] }).includes('USER: earlier'));

// Files: nothing outside the project folder can be read or written.
assert.equal(inside('C:\\p\\snake', '..\\evil.txt'), null);
assert.equal(inside('C:\\p\\snake', 'C:\\Windows\\win.ini'), null);
assert.equal(inside('C:\\p\\snake', ''), null);
assert.ok(inside('C:\\p\\snake', 'src/main.js'));
assert.throws(() => projectPath('../x'));
assert.throws(() => projectPath('Bad Name'));
assert.match(projectPath('neon-snake'), /projects[\\/]neon-snake$/);

console.log('all checks passed');
