import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyFiles = [
  'skills/dev-flow-planning/SKILL.md',
  'skills/dev-flow-acceptance/SKILL.md',
  'skills/dev-flow-loop/SKILL.md',
  'skills/dev-flow-master/references/state-and-gates.md',
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

test('gate skills use bounded convergence instead of an unconditional 95-point loop', async () => {
  for (const relativePath of policyFiles) {
    const content = await read(relativePath);
    assert.match(content, /quality target[^\n]*95/i, `${relativePath} must keep 95 as a target`);
    assert.match(content, /convergence floor[^\n]*90/i, `${relativePath} must define the 90-point floor`);
    assert.match(content, /material finding/i, `${relativePath} must gate on material findings`);
    assert.match(content, /max_checker_evaluations/i, `${relativePath} must use the configurable checker budget`);
    assert.match(content, /default[^\n]*3/i, `${relativePath} must define the default checker budget`);
    assert.doesNotMatch(content, /two checker evaluations/i, `${relativePath} must not hard-code two evaluations`);
    assert.match(content, /YAML/i, `${relativePath} must reject non-functional YAML churn`);
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
