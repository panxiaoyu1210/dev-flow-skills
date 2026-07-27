import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { queryNext } from '../lib/graph/index.mjs';

const root = new URL('../', import.meta.url);
const cli = new URL('../bin/dev-flow.mjs', import.meta.url).pathname;

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function projection(nodes = []) {
  return `\`\`\`dev-flow-graph\n${JSON.stringify({ nodes, edges: [], permissions: [] })}\n\`\`\``;
}

test('Shadow init rejects a source set without an explicit projection', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-missing-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const markdownPath = path.join(directory, 'legacy.md');
  await writeFile(markdownPath, '# Ordinary Legacy state\n\nNo Graph projection is opted in.\n');
  const result = run(directory, 'graph', 'init', '--graph', path.join(directory, 'shadow.json'),
    '--type', 'master', '--mode', 'shadow', '--markdown', markdownPath, '--json');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'shadow_projection_missing');
});

test('Shadow init returns stable invalid and ambiguous projection errors', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-invalid-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const markdownPath = path.join(directory, 'state.md');
  await writeFile(markdownPath, '```dev-flow-graph\n{not-json}\n```\n');
  const invalid = run(directory, 'graph', 'init', '--graph', path.join(directory, 'invalid.json'),
    '--type', 'master', '--mode', 'shadow', '--markdown', markdownPath, '--json');
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'shadow_projection_invalid');

  await writeFile(markdownPath, '```dev-flow-graph\nnull\n```\n');
  const invalidShape = run(directory, 'graph', 'init', '--graph', path.join(directory, 'invalid-shape.json'),
    '--type', 'master', '--mode', 'shadow', '--markdown', markdownPath, '--json');
  assert.equal(invalidShape.status, 2, invalidShape.stderr);
  assert.equal(JSON.parse(invalidShape.stdout).error.code, 'shadow_projection_invalid');

  await writeFile(markdownPath, `${projection()}\n\n${projection()}\n`);
  const ambiguous = run(directory, 'graph', 'init', '--graph', path.join(directory, 'ambiguous.json'),
    '--type', 'master', '--mode', 'shadow', '--markdown', markdownPath, '--json');
  assert.equal(ambiguous.status, 2, ambiguous.stderr);
  assert.equal(JSON.parse(ambiguous.stdout).error.code, 'shadow_projection_ambiguous');
});

test('Shadow check reports the projection contract, not an empty snapshot or generic drift', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-check-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const markdownPath = path.join(directory, 'state.md');
  const graphPath = path.join(directory, 'shadow.json');
  await writeFile(markdownPath, `${projection()}\n`);
  assert.equal(run(directory, 'graph', 'init', '--graph', graphPath, '--type', 'master',
    '--mode', 'shadow', '--markdown', markdownPath, '--json').status, 0);
  await writeFile(markdownPath, '# Projection intentionally removed\n');
  const result = run(directory, 'graph', 'check', '--graph', graphPath, '--json');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'shadow_projection_missing');
});

test('empty Graphs route to definition work instead of acceptance or completion', () => {
  assert.deepEqual(queryNext({ graphKind: 'master', nodes: [], edges: [] }), {
    graphKind: 'master',
    owner: 'master',
    action: 'define_requirement',
    targetNodeIds: [],
    blockers: [{ code: 'requirement_scope_missing', relatedNodeIds: [], refs: [] }],
    eligibleTasks: [],
    blockedTasks: [],
    eligiblePhases: [],
    blockedPhases: [],
    blocked: false,
  });
  assert.deepEqual(queryNext({ graphKind: 'loop', nodes: [], edges: [] }), {
    graphKind: 'loop',
    owner: 'loop-controller',
    action: 'establish_goal_baseline',
    targetNodeIds: [],
    blockers: [
      { code: 'missing_baseline_control', relatedNodeIds: [], refs: [] },
      { code: 'missing_goal_control', relatedNodeIds: [], refs: [] },
    ],
    eligibleTasks: [],
    blockedTasks: [],
    eligiblePhases: [],
    blockedPhases: [],
    blocked: false,
  });
});

test('explicit impact without a Graph is an unknown-impact workflow block', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-impact-missing-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const result = run(directory, 'graph', 'impact', '--graph', path.join(directory, 'absent.json'),
    '--kind', 'file', '--source', 'src/unmodelled.mjs', '--json');
  assert.equal(result.status, 3, result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'unknown_impact');
  assert.equal(run(directory, 'graph', 'next', '--graph', path.join(directory, 'absent.json'), '--json').status, 0);
});

test('structured authoring lint rejects subjective criteria and authority write-back sediment', async () => {
  const {
    lintAuthorityLanguage,
    lintGraphProtocolAuthoring,
    lintSkillAuthoring,
  } = await import('../lib/graph/authoring.mjs');

  const invalidCriterion = lintSkillAuthoring('1. **Do work.**\n   **Complete when:** the step feels done.\n');
  assert.equal(invalidCriterion.valid, false);
  assert.ok(invalidCriterion.findings.some((item) => item.code === 'completion_criterion_not_observable'));

  assert.equal(lintSkillAuthoring(
    '1. **Validate work.**\n   **Complete when:** the named command exits successfully and its result is recorded.\n',
  ).valid, true);
  assert.equal(lintAuthorityLanguage('Markdown is canonical and writes back into Graph state.').valid, false);
  assert.equal(lintAuthorityLanguage('Legacy mode keeps Markdown authoritative.').valid, true);
  assert.equal(lintAuthorityLanguage(
    'Graph mode writes control facts only through the Graph CLI/API; its generated Markdown view is never read back.',
  ).valid, true);

  const incompleteProtocol = lintGraphProtocolAuthoring('Shadow copies Markdown. Graph is authoritative.');
  assert.equal(incompleteProtocol.valid, false);
  const completeProtocol = lintGraphProtocolAuthoring([
    'Shadow is explicit opt-in through exactly one fenced ```dev-flow-graph JSON projection per source.',
    'init and check reject shadow_projection_missing, shadow_projection_invalid, and shadow_projection_ambiguous.',
    'Drift blocks routing; refresh is a new explicit one-way snapshot and never a merge.',
    'Graph recovery order is actual state -> Graph -> OpenSpec/evidence views.',
    'Control facts are written only through the Graph CLI/API; generated Markdown views are never read back.',
  ].join('\n'));
  assert.equal(completeProtocol.valid, true, JSON.stringify(completeProtocol.findings));
});

test('affected Skills, references, docs, and commands pass structured authority lint', async () => {
  const { lintAuthorityLanguage } = await import('../lib/graph/authoring.mjs');
  const files = [
    'skills/dev-flow-master/SKILL.md',
    'skills/dev-flow-master/references/state-and-gates.md',
    'skills/dev-flow-master/references/flow-and-recovery.md',
    'skills/dev-flow-planning/SKILL.md',
    'skills/dev-flow-execution/SKILL.md',
    'skills/dev-flow-execution/references/replanning-and-recovery.md',
    'skills/dev-flow-git/SKILL.md',
    'skills/dev-flow-acceptance/SKILL.md',
    'skills/dev-flow-loop/SKILL.md',
    'skills/dev-flow-loop/references/control-plane.md',
    'skills/dev-flow-loop-envelope/SKILL.md',
    'commands/dev-flow.md',
    'commands/dev-flow-loop.md',
    'docs/graph-control-kernel.md',
    'docs/workflow-overview.md',
    'README.md',
    'README.zh-CN.md',
  ];
  for (const file of files) {
    const result = lintAuthorityLanguage(await readFile(new URL(file, root), 'utf8'), { filePath: file });
    assert.equal(result.valid, true, `${file}: ${JSON.stringify(result.findings)}`);
  }
});

test('prose points to CLI help instead of copying numeric exit-code mappings', async () => {
  const files = [
    'skills/dev-flow-master/references/graph-control.md',
    'skills/dev-flow-loop/references/graph-control.md',
    'commands/dev-flow.md',
    'commands/dev-flow-loop.md',
    'docs/graph-control-kernel.md',
    'README.md',
    'README.zh-CN.md',
  ];
  for (const file of files) {
    const content = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(content, /(?:exit(?: code)?\s*[0-3]|\|\s*[0-3]\s*\|)/i, file);
  }
  assert.match(await readFile(new URL('docs/graph-control-kernel.md', root), 'utf8'), /dev-flow graph --help/);
});
