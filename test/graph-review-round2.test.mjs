import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { lintAuthorityLanguage, lintSkillAuthoring } from '../lib/graph/authoring.mjs';

const root = new URL('../', import.meta.url);
const cli = new URL('../bin/dev-flow.mjs', import.meta.url).pathname;

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

function localLine(content, needle) {
  const line = content.split(/\r?\n/).find((item) => item.includes(needle));
  assert.ok(line, `missing line containing ${needle}`);
  return line;
}

function assertLocalAuthorityBranches(content, needle) {
  const line = localLine(content, needle);
  for (const phrase of ['Legacy', 'Shadow', 'Graph', 'CLI/API']) assert.match(line, new RegExp(phrase), `${needle}: ${phrase}`);
}

test('authority lint rejects Graph-mode write-back and deceptive negation', () => {
  const invalid = [
    'Graph mode allows generated Markdown to overwrite Graph state.',
    'Graph mode may use dev-flow-state.md to rewrite Graph state.',
    'Graph mode should not block bidirectional merge; Markdown and Graph are dual-writable.',
    'Never block reviewer feedback; Graph mode allows Markdown to overwrite Graph state.',
  ];
  for (const content of invalid) {
    const result = lintAuthorityLanguage(content);
    assert.equal(result.valid, false, `${content}: ${JSON.stringify(result.findings)}`);
  }

  for (const content of [
    'Graph mode must not allow generated Markdown to overwrite Graph state.',
    'Graph mode never uses dev-flow-state.md to rewrite Graph state.',
    'Bidirectional merge and dual-writable Graph/Markdown control facts are forbidden.',
    'A Markdown file is tracked when it is a canonical formal artifact.',
  ]) assert.equal(lintAuthorityLanguage(content).valid, true, content);
});

test('completion lint rejects generic readiness tautology', () => {
  const result = lintSkillAuthoring('1. **Finish.**\n   **Complete when:** Everything is complete and ready.\n');
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((item) => item.code === 'completion_criterion_not_observable'));
});

test('doctor lints a mutated installed Skill instead of only canonical source', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-authoring-doctor-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const install = run(directory, 'install', '--target', directory);
  assert.equal(install.status, 0, install.stderr);
  const skillPath = path.join(directory, '.opencode', 'skills', 'dev-flow-master', 'SKILL.md');
  const skill = await readFile(skillPath, 'utf8');
  await writeFile(skillPath, skill.replace(
    /\*\*Complete when:\*\*[^\n]+/,
    '**Complete when:** Everything is complete and ready.',
  ));
  const doctor = run(directory, 'doctor', '--target', directory);
  assert.equal(doctor.status, 1, doctor.stdout);
  assert.match(doctor.stdout, /✗ Graph Skill authoring contract/);
});

test('reviewer-specified control writes branch locally by authority mode', async () => {
  assertLocalAuthorityBranches(
    await read('skills/dev-flow-master/references/flow-and-recovery.md'),
    'Record the loop authorization',
  );
  const loop = await read('skills/dev-flow-loop/references/control-plane.md');
  assertLocalAuthorityBranches(loop, 'phase_eval` / `loop_eval');
  assertLocalAuthorityBranches(loop, 'The moment Execution Envelope Gate is approved');
  assertLocalAuthorityBranches(
    await read('skills/dev-flow-planning/references/phase-1-documents.md'),
    'Persist the checker score',
  );
  assertLocalAuthorityBranches(await read('commands/dev-flow-loop.md'), 'Persist delivery-loop control artifacts');
});

test('Graph docs keep machine and procedure authority singular and bound lint claims', async () => {
  const docs = await read('docs/graph-control-kernel.md');
  assert.match(docs, /schemas\/v1\/.*CLI\/library.*machine rules/i);
  assert.match(docs, /agent procedure.*direct reference/i);
  assert.doesNotMatch(docs, /here\/Master reference/i);
  assert.match(docs, /finite.*observable.*heuristic/i);
  assert.match(docs, /does not replace.*independent.*writing-great-skills.*semantic review/i);
});
