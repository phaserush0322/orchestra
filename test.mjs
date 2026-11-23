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
console.log('all checks passed');
