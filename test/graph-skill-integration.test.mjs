import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const graphSkills = [
  'dev-flow-master',
  'dev-flow-planning',
  'dev-flow-execution',
  'dev-flow-git',
  'dev-flow-acceptance',
  'dev-flow-loop',
  'dev-flow-loop-envelope',
];

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

function lineCount(content) {
  return content.replace(/\n$/, '').split('\n').length;
}

test('Graph-aware Skills stay lean, executable, and point to machine authority', async () => {
  for (const skill of graphSkills) {
    const content = await read(`skills/${skill}/SKILL.md`);
    assert.ok(lineCount(content) <= 80, `${skill} must stay within 80 lines`);
    const steps = content.match(/^\d+\. \*\*/gm) ?? [];
    const completions = content.match(/^\s+\*\*Complete when:\*\*/gm) ?? [];
    assert.ok(steps.length > 0, `${skill} needs executable steps`);
    assert.equal(completions.length, steps.length, `${skill} needs one checkable completion criterion per step`);
    assert.match(content, /dev-flow graph/, `${skill} needs a Graph CLI context pointer`);
    assert.match(content, /schemas\/v1\/.*CLI|CLI.*schemas\/v1\//s, `${skill} must point to schema and CLI authority`);
    assert.doesNotMatch(content, /```(?:json|yaml)/, `${skill} must not duplicate machine contracts`);
  }
});

test('Master and Loop Graph protocols are disclosed behind direct context pointers', async () => {
  const masterSkill = await read('skills/dev-flow-master/SKILL.md');
  const loopSkill = await read('skills/dev-flow-loop/SKILL.md');
  assert.match(masterSkill, /references\/graph-control\.md/);
  assert.match(loopSkill, /references\/graph-control\.md/);

  const masterProtocol = await read('skills/dev-flow-master/references/graph-control.md');
  const loopProtocol = await read('skills/dev-flow-loop/references/graph-control.md');
  assert.match(masterProtocol, /Legacy.*Shadow.*Graph/s);
  assert.match(masterProtocol, /Docs\/<topic>\/dev-flow-graph\.json/);
  assert.match(masterProtocol, /unknown_impact/);
  assert.match(loopProtocol, /Docs\/<topic>\/loop\/loop-graph\.json/);
  assert.match(loopProtocol, /Loop Graph.*Master Graph/s);
  assert.match(loopProtocol, /phase handoff/i);
});

test('Graph documentation covers commands, authority, paths, result pointer, and package surface', async () => {
  const docs = await read('docs/graph-control-kernel.md');
  for (const command of ['init', 'check', 'impact', 'next', 'context', 'transition']) {
    assert.match(docs, new RegExp(`dev-flow graph ${command}`), command);
  }
  for (const mode of ['Legacy', 'Shadow', 'Graph']) assert.match(docs, new RegExp(mode));
  assert.match(docs, /dev-flow graph --help/);
  assert.doesNotMatch(docs, /\|\s*[0-3]\s*\|/);
  assert.match(docs, /```dev-flow-graph/);
  for (const code of ['shadow_projection_missing', 'shadow_projection_invalid', 'shadow_projection_ambiguous']) {
    assert.match(docs, new RegExp(code));
  }
  assert.match(docs, /Docs\/<topic>\/dev-flow-graph\.json/);
  assert.match(docs, /Docs\/<topic>\/loop\/loop-graph\.json/);
  assert.match(docs, /\.dev-flow\/runtime\/<run-id>\//);
  assert.match(docs, /lib\/graph\/\*\*/);
  assert.match(docs, /schemas\/\*\*/);
});

test('Graph command and affected Skill mirrors remain byte-identical', async () => {
  for (const skill of graphSkills) {
    const canonicalFiles = [
      `skills/${skill}/SKILL.md`,
      ...(
        ['dev-flow-master', 'dev-flow-loop'].includes(skill)
          ? [`skills/${skill}/references/graph-control.md`]
          : []
      ),
    ];
    for (const canonicalPath of canonicalFiles) {
      const relative = canonicalPath.slice('skills/'.length);
      assert.equal(await read(`.opencode/skills/${relative}`), await read(canonicalPath), relative);
    }
  }

  for (const command of ['dev-flow.md', 'dev-flow-loop.md']) {
    const canonical = await read(`commands/${command}`);
    assert.equal(await read(`.opencode/command/${command}`), canonical, `OpenCode ${command}`);
    assert.equal(await read(`commands/claude/${command}`), canonical, `Claude ${command}`);
  }
});

test('Master and Loop commands invoke their isolated Graph protocols', async () => {
  const master = await read('commands/dev-flow.md');
  assert.match(master, /Docs\/<topic>\/dev-flow-graph\.json/);
  for (const operation of ['check', 'next', 'context', 'impact', 'transition']) {
    assert.match(master, new RegExp(`(?:graph )?${operation}`), `Master command ${operation}`);
  }

  const loop = await read('commands/dev-flow-loop.md');
  assert.match(loop, /Docs\/<topic>\/loop\/loop-graph\.json/);
  assert.match(loop, /Loop Graph and Master Graph isolated/);
  assert.match(loop, /structured phase handoff/);
  assert.match(loop, /never schedules Master-internal Tasks/);
  assert.match(loop, /unknown_impact/);
});

test('doctor reports Graph contracts, exports, package files, Skills, and docs ready', () => {
  const result = spawnSync(process.execPath, ['bin/dev-flow.mjs', 'doctor', '--target', '.'], {
    cwd: new URL('.', root),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const label of [
    'Graph schemas compile',
    'Graph kernel exports',
    'Graph CLI help contract',
    'Graph package surface',
    'Graph Skill authoring contract',
    'Graph documentation contract',
  ]) {
    assert.match(result.stdout, new RegExp(`✓ ${label}`), label);
  }
});
