import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { lintAuthorityLanguage } from '../lib/graph/authoring.mjs';

const root = new URL('../', import.meta.url);
const cli = new URL('../bin/dev-flow.mjs', import.meta.url).pathname;

const deceptiveAuthorityWrites = [
  'Graph mode never blocks reviewer feedback, and generated Markdown overwrites Graph state.',
  'Graph mode does not merely inspect Markdown; it overwrites Graph state.',
  'Never block reviewer feedback. Graph mode allows generated Markdown to overwrite Graph state.',
  'Never ignore generated Markdown, which overwrites Graph state.',
  'Markdown is never ignored, and therefore overwrites Graph state.',
  'Graph 模式允许 Markdown 回写 Graph 状态。',
];

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

function lineContaining(content, needle) {
  const line = content.split(/\r?\n/).find((item) => item.includes(needle));
  assert.ok(line, `missing line containing ${needle}`);
  return line;
}

function assertModeLocal(line, needle) {
  for (const phrase of ['Legacy', 'Shadow', 'Graph']) assert.match(line, new RegExp(phrase), `${needle}: ${phrase}`);
}

test('authority lint rejects every deceptive local-negation and Chinese write-back case', () => {
  for (const content of deceptiveAuthorityWrites) {
    const result = lintAuthorityLanguage(content);
    assert.equal(result.valid, false, `${content}: ${JSON.stringify(result.findings)}`);
  }
  assert.equal(
    lintAuthorityLanguage('Graph mode must not allow generated Markdown to overwrite Graph state.').valid,
    true,
  );
});

test('doctor rejects deceptive authority writes in an installed reference', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-authority-round3-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const install = run(directory, 'install', '--target', directory);
  assert.equal(install.status, 0, install.stderr);
  const referencePath = path.join(directory, '.opencode', 'skills', 'dev-flow-master', 'references', 'graph-control.md');
  const original = await readFile(referencePath, 'utf8');
  for (const content of deceptiveAuthorityWrites) {
    await writeFile(referencePath, `${original}\n${content}\n`);
    const doctor = run(directory, 'doctor', '--target', directory);
    assert.equal(doctor.status, 1, `${content}\n${doctor.stdout}`);
    assert.match(doctor.stdout, /✗ Graph Skill authoring contract/);
  }
});

test('Master progress and recovery make Graph queries the sole control input', async () => {
  const master = await read('skills/dev-flow-master/references/flow-and-recovery.md');
  for (const needle of [
    'When the user asks “进度怎么样',
    'unresolved gate',
    '`progress.md` says',
    '`dev-flow-state.md`, `task-orchestration.md`, and `progress.md` disagree',
  ]) {
    const line = lineContaining(master, needle);
    assertModeLocal(line, needle);
    assert.match(line, /check/i, `${needle}: check`);
    assert.match(line, /next/i, `${needle}: next`);
    assert.match(line, /context/i, `${needle}: context`);
    assert.match(line, /(?:never|not).*input|non-input/i, `${needle}: view non-input`);
  }
  assert.match(master, /stale|tampered/i);
  assert.match(master, /regenerate/i);
});

test('Execution recovery never resumes Graph control from progress or plan views', async () => {
  const execution = await read('skills/dev-flow-execution/references/replanning-and-recovery.md');
  const source = lineContaining(execution, 'active control state:');
  assertModeLocal(source, 'active control state');
  assert.match(source, /check/i);
  assert.match(source, /next/i);
  assert.match(source, /context/i);
  assert.match(source, /(?:never|not).*input|non-input/i);
  const resume = lineContaining(execution, 'records requirement change');
  assertModeLocal(resume, 'records requirement change');
  assert.match(resume, /check/i);
  assert.match(resume, /next/i);
  assert.match(resume, /context/i);
  assert.match(resume, /regenerate/i);
});

test('Acceptance keeps Markdown gate and file criteria outside Graph readiness', async () => {
  const acceptance = await read('skills/dev-flow-acceptance/references/readiness-and-report.md');
  const authority = lineContaining(acceptance, 'Graph mode additionally requires');
  assertModeLocal(authority, 'acceptance authority');
  assert.match(authority, /check/i);
  assert.match(authority, /next/i);
  assert.match(authority, /context/i);
  assert.match(authority, /sole control/i);
  assert.match(authority, /Markdown.*(?:never|not).*completion/i);
  assert.match(acceptance, /For governed medium\/heavy Legacy\/Shadow work/);
  assert.match(acceptance, /For lightweight Legacy\/Shadow/i);
});

test('adjacent dispatch, completion, Loop, and overview routes keep views non-controlling', async () => {
  const cases = [
    [
      await read('skills/dev-flow-execution/references/runtime-and-dispatch.md'),
      'active control state:',
    ],
    [
      await read('skills/dev-flow-master/references/state-and-gates.md'),
      'Resolve completion from the active authority',
    ],
    [
      await read('skills/dev-flow-loop/references/control-plane.md'),
      'Active Loop control state:',
    ],
    [
      await read('docs/workflow-overview.md'),
      '`dev-flow-acceptance` collects verification evidence',
    ],
  ];
  for (const [content, needle] of cases) {
    const line = lineContaining(content, needle);
    assertModeLocal(line, needle);
    assert.match(line, /check/i, `${needle}: check`);
    assert.match(line, /next/i, `${needle}: next`);
    assert.match(line, /context/i, `${needle}: context`);
    assert.match(line, /(?:non-input|only.*Graph|Graph uses only)/i, `${needle}: view non-input`);
  }
});
