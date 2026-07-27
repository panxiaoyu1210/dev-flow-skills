import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../bin/dev-flow.mjs', import.meta.url).pathname;

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

test('top-level and graph help expose all six commands', () => {
  for (const args of [['--help'], ['graph', '--help']]) {
    const result = run(process.cwd(), ...args);
    assert.equal(result.status, 0, result.stderr);
    for (const command of ['init', 'check', 'impact', 'next', 'context', 'transition']) {
      assert.match(result.stdout, new RegExp(`graph ${command}|  ${command}`));
    }
  }
});

test('CLI JSON uses single envelopes and stable 0/2/3 exits', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-cli-exits-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graphPath = path.join(directory, 'graph.json');
  const init = run(directory, 'graph', 'init', '--graph', graphPath, '--type', 'master', '--mode', 'graph', '--json');
  assert.equal(init.status, 0, init.stderr);
  assert.equal(JSON.parse(init.stdout).ok, true);
  const duplicate = run(directory, 'graph', 'init', '--graph', graphPath, '--type', 'master', '--mode', 'graph', '--json');
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(duplicate.stdout).error.code, 'graph_exists');

  await writeFile(graphPath, '{"invalid":true}\n');
  const invalid = run(directory, 'graph', 'check', '--graph', graphPath, '--json');
  assert.equal(invalid.status, 2);
  const invalidEnvelope = JSON.parse(invalid.stdout);
  assert.equal(invalidEnvelope.ok, false);
  assert.deepEqual(Object.keys(invalidEnvelope.error.findings[0]), ['code', 'rule', 'path', 'nodeIds', 'message']);

  const shadow = await fixture('valid-loop');
  await writeFile(graphPath, `${JSON.stringify(shadow)}\n`);
  const blocked = run(directory, 'graph', 'transition', '--graph', graphPath, '--node', 'phase.checkout', '--to', 'active', '--actor', 'loop-controller', '--json');
  assert.equal(blocked.status, 3);
  assert.equal(JSON.parse(blocked.stdout).error.code, 'authority_read_only');
});

test('CLI human output, impact apply, next, and context are operational', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-cli-ops-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graph = await fixture('valid-master');
  const graphPath = path.join(directory, 'graph.json');
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  assert.equal(run(directory, 'graph', 'check', '--graph', graphPath).status, 0);
  assert.equal(run(directory, 'graph', 'impact', '--graph', graphPath, '--kind', 'file', '--source', 'src/checkout.mjs', '--apply').status, 0);
  assert.equal((JSON.parse(await readFile(graphPath, 'utf8'))).nodes.find((node) => node.id === 'task.checkout').status, 'stale');
  assert.equal(run(directory, 'graph', 'next', '--graph', graphPath, '--json').status, 0);
  const context = run(directory, 'graph', 'context', '--graph', graphPath, '--node', 'task.checkout', '--json');
  assert.equal(context.status, 0, context.stderr);
  assert.equal(JSON.parse(context.stdout).data.schemaVersion, '1.0.0');
});

test('missing Graph remains Legacy-compatible', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-cli-legacy-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const result = run(directory, 'graph', 'next', '--graph', path.join(directory, 'absent.json'), '--json');
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.authorityMode, 'legacy');
  assert.equal(envelope.data.action, 'continue_markdown_workflow');
});

test('Shadow reports drift and rejects mutation while Graph ignores view tampering', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-cli-authority-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.md');
  await writeFile(sourcePath, 'changed markdown\n');
  const shadow = await fixture('valid-loop');
  shadow.nodes[0].ref = sourcePath;
  shadow.nodes[0].hash = 'a'.repeat(64);
  const shadowPath = path.join(directory, 'shadow.json');
  await writeFile(shadowPath, `${JSON.stringify(shadow)}\n`);
  const drift = run(directory, 'graph', 'check', '--graph', shadowPath, '--json');
  assert.equal(drift.status, 2);
  assert.ok(JSON.parse(drift.stdout).error.findings.some((item) => item.code === 'shadow_drift'));
  assert.equal(run(directory, 'graph', 'impact', '--graph', shadowPath, '--kind', 'file', '--source', 'x', '--apply', '--json').status, 3);

  const master = await fixture('valid-master');
  const graphPath = path.join(directory, 'master.json');
  const viewPath = path.join(directory, 'master.md');
  master.nodes.find((node) => node.id === 'gate.checkout').status = 'passed';
  await writeFile(graphPath, `${JSON.stringify(master)}\n`);
  await writeFile(viewPath, '# tampered\n');
  const before = await readFile(graphPath, 'utf8');
  const next = run(directory, 'graph', 'next', '--graph', graphPath, '--json');
  assert.equal(next.status, 0, next.stderr);
  assert.equal(await readFile(graphPath, 'utf8'), before);
});
