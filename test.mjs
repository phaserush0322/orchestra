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
import { parseRunBlock, chatPrompt, chatCommand } from './chat.mjs';
import { inside, projectPath } from './server.mjs';
const reply = 'On it.\n<orchestra-run>\n{"project":"Neon Snake!","flow":"game","skills":["web-game","made-up"],"brief":"Build a snake game"}\n</orchestra-run>';
const pr = parseRunBlock(reply, { skills: ['web-game'] });
assert.equal(pr.text, 'On it.');
assert.deepEqual(pr.run, { brief: 'Build a snake game', flow: 'game', skills: ['web-game'], project: 'neon-snake' });
assert.equal(parseRunBlock('Just an answer.').run, null);
assert.equal(parseRunBlock('x <orchestra-run>{"brief":"make a todo app","flow":"nope"}</orchestra-run>').run.flow, 'default');
assert.ok(parseRunBlock('x <orchestra-run>not json</orchestra-run>').error);
assert.ok(parseRunBlock('x <orchestra-run>{"flow":"game"}</orchestra-run>').error);
assert.match(chatCommand(), /^claude -p --model claude-sonnet-5-5 .*--tools Read,Glob,Grep/);
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
