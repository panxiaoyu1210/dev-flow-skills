import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policySource = 'skills/dev-flow-master/references/state-and-gates.md';
const policyConsumers = [
  'skills/dev-flow-planning/SKILL.md',
  'skills/dev-flow-acceptance/SKILL.md',
  'skills/dev-flow-loop/SKILL.md',
];

const mirroredFiles = [
  'dev-flow-planning/SKILL.md',
  'dev-flow-acceptance/SKILL.md',
  'dev-flow-acceptance/references/readiness-and-report.md',
  'dev-flow-git/SKILL.md',
  'dev-flow-git/references/operations-and-safety.md',
  'dev-flow-loop/SKILL.md',
  'dev-flow-loop/references/control-plane.md',
  'dev-flow-loop-envelope/SKILL.md',
  'dev-flow-loop-envelope/references/budget-and-safety.md',
  'dev-flow-master/references/state-and-gates.md',
];

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('gate skills point to one bounded-convergence source instead of duplicating it', async () => {
  const source = await read(policySource);
  assert.match(source, /quality target[^\n]*95/i);
  assert.match(source, /convergence floor[^\n]*90/i);
  assert.match(source, /material finding/i);
  assert.match(source, /max_checker_evaluations/i);
  assert.match(source, /default[^\n]*3/i);
  assert.doesNotMatch(source, /two checker evaluations/i);
  assert.match(source, /YAML/i);

  for (const relativePath of policyConsumers) {
    const content = await read(relativePath);
    assert.match(content, /dev-flow-master\/references\/state-and-gates\.md/,
      `${relativePath} must point to the shared policy`);
    assert.match(content, /bounded-convergence/i, `${relativePath} must name the shared rule`);
    assert.doesNotMatch(content, /quality target[^\n]*95/i,
      `${relativePath} must not duplicate threshold semantics`);
    assert.doesNotMatch(content, /convergence floor[^\n]*90/i,
      `${relativePath} must not duplicate threshold semantics`);
  }
});

test('checker evaluation budget is configurable without a fixed range', async () => {
  const [envelope, master] = await Promise.all([
    read('skills/dev-flow-loop-envelope/references/budget-and-safety.md'),
    read('skills/dev-flow-master/references/state-and-gates.md'),
  ]);

  for (const [name, content] of [['loop envelope', envelope], ['master policy', master]]) {
    assert.match(content, /max_checker_evaluations/i, `${name} must name the setting`);
    assert.match(content, /no fixed numeric range/i, `${name} must not impose a range`);
    assert.match(content, /must not increase[^\n]*without explicit user approval/i, `${name} must prevent self-extension`);
  }
});

test('legacy unconditional retry language is removed from active skills', async () => {
  const activeSkillFiles = [
    'skills/dev-flow-loop/SKILL.md',
    'skills/dev-flow-loop/references/control-plane.md',
    'skills/dev-flow-planning/references/phase-1-documents.md',
    'skills/dev-flow-planning/references/task-orchestration.md',
    'skills/dev-flow-acceptance/references/readiness-and-report.md',
  ];

  for (const relativePath of activeSkillFiles) {
    const content = await read(relativePath);
    assert.doesNotMatch(content, /auto-revise against all findings until checker score/i, relativePath);
    assert.doesNotMatch(content, /repeat until checker score\s*(?:>=|≥)\s*95/i, relativePath);
  }
});

test('Git tracks formal artifacts and excludes transient verification output', async () => {
  const files = [
    'skills/dev-flow-git/SKILL.md',
    'skills/dev-flow-git/references/operations-and-safety.md',
    'skills/dev-flow-master/references/state-and-gates.md',
    'skills/dev-flow-loop/references/control-plane.md',
    'skills/dev-flow-acceptance/references/readiness-and-report.md',
  ];
  const content = (await Promise.all(files.map(read))).join('\n');

  for (const artifact of [
    'dev-flow-state.md',
    'progress.md',
    'delivery-report.md',
    'loop-state.md',
    'loop-phase-dag.md',
    'loop-envelope.md',
    'phase-artifacts.md',
    'opsx-index.md',
    'test-cases.xlsx',
  ]) {
    assert.match(content, new RegExp(`Git-tracked formal artifacts[^\\n]*${artifact.replace('.', '\\.')}`, 'i'), `${artifact} must be tracked`);
  }

  assert.match(content, /\.dev-flow\/runtime\/<run-id>\//i, 'transient output must use the runtime directory');
  assert.match(content, /\.git\/info\/exclude/i, 'Git repositories must locally exclude runtime output');
  assert.match(content, /do not modify[^\n]*\.gitignore/i, 'project .gitignore must remain untouched');
  assert.match(content, /staging allowlist/i, 'staging must use an allowlist');
  assert.match(content, /do not use[^\n]*git add -A[^\n]*git add \./i, 'broad staging must be forbidden');

  for (const transient of ['raw checker', 'stdout/stderr', 'coverage', 'screenshots', 'browser traces', 'benchmark', 'temporary patches']) {
    assert.match(content, new RegExp(transient, 'i'), `${transient} must be classified as transient`);
  }
});

test('workflow owners preserve the formal-versus-transient artifact boundary', async () => {
  const files = [
    'skills/dev-flow-master/references/state-and-gates.md',
    'skills/dev-flow-execution/references/task-settlement-and-modes.md',
    'skills/dev-flow-loop/references/control-plane.md',
    'skills/dev-flow-acceptance/references/readiness-and-report.md',
  ];

  for (const relativePath of files) {
    const content = await read(relativePath);
    assert.match(content, /Git-tracked formal artifacts/i, `${relativePath} must keep formal artifacts tracked`);
    assert.match(content, /\.dev-flow\/runtime\/<run-id>\//i, `${relativePath} must isolate transient output`);
    assert.match(content, /staging allowlist/i, `${relativePath} must stage only formal artifacts`);
  }
});

test('OpenCode mirrors stay byte-for-byte aligned with canonical skill files', async () => {
  for (const relativePath of mirroredFiles) {
    const [canonical, mirror] = await Promise.all([
      read(`skills/${relativePath}`),
      read(`.opencode/skills/${relativePath}`),
    ]);
    assert.equal(mirror, canonical, relativePath);
  }
});
