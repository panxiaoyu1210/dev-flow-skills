import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  GraphValidationError,
  atomicWriteJson,
  createEventResolver,
  readJson,
  sha256,
  stableStringify,
  writeGraphFile,
  writeRuntimeEvent,
} from '../lib/graph/index.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

test('graph writes are atomic, validated, and create-exclusive when requested', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-graph-io-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  const graphPath = path.join(directory, 'dev-flow-graph.json');
  const graph = await fixture('valid-master');

  await writeGraphFile(graphPath, graph, { exclusive: true });
  assert.deepEqual(await readJson(graphPath), graph);
  await assert.rejects(
    writeGraphFile(graphPath, graph, { exclusive: true }),
    (error) => error.code === 'EEXIST',
  );

  const invalidPath = path.join(directory, 'invalid.json');
  const invalid = structuredClone(graph);
  invalid.nodes.find((node) => node.type === 'Gate').prerequisiteIds = [];
  await assert.rejects(
    writeGraphFile(invalidPath, invalid),
    (error) => error instanceof GraphValidationError && error.exitCode === 2,
  );
  await assert.rejects(access(invalidPath));
});

test('raw events are persisted before resolvable graph references and may remain orphaned', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-runtime-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  const graph = await fixture('valid-master');
  const event = {
    schemaVersion: '1.0.0',
    id: 'event.checkout',
    graphId: graph.id,
    eventType: 'transition',
    occurredAt: '2026-07-24T09:30:00.000Z',
    actorId: 'maker.checkout',
    subjectIds: ['task.checkout'],
    payload: { from: 'planned', to: 'ready' },
  };

  const eventRef = await writeRuntimeEvent(directory, event);
  assert.equal(eventRef.hash, sha256(stableStringify(event)));
  assert.deepEqual(await createEventResolver(directory)(eventRef), event);

  graph.eventRefs.push(eventRef);
  await writeGraphFile(path.join(directory, 'dev-flow-graph.json'), graph, {
    eventResolver: createEventResolver(directory),
  });

  const orphan = { ...event, id: 'event.orphan' };
  await writeRuntimeEvent(directory, orphan);
  await access(path.join(directory, 'event.orphan.json'));
});

test('temporary files are removed when serialization or write setup fails', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-temp-cleanup-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    atomicWriteJson(path.join(directory, 'graph.json'), { unsupported: 1n }),
    TypeError,
  );
  assert.deepEqual(await readdir(directory), []);
});

test('graph files with event references cannot be written without an event resolver', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-event-integrity-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  const graph = await fixture('valid-master');
  graph.eventRefs = [{ id: 'event.absent', ref: path.join(directory, 'event.absent.json'), hash: 'a'.repeat(64) }];
  const destination = path.join(directory, 'dev-flow-graph.json');
  await assert.rejects(
    writeGraphFile(destination, graph),
    (error) => error instanceof GraphValidationError
      && error.findings.some((finding) => finding.code === 'event_resolver_required'),
  );
  await assert.rejects(access(destination));
});

test('raw Event persistence rejects an impossible UTC occurredAt', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-event-time-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  const event = JSON.parse(await readFile(
    new URL('./fixtures/contracts/invalid-event-timestamp.json', import.meta.url),
    'utf8',
  ));
  await assert.rejects(
    writeRuntimeEvent(directory, event),
    (error) => error instanceof GraphValidationError
      && error.findings.some(
        (finding) => finding.path === '/occurredAt' && finding.rule === 'json_schema.format',
      ),
  );
  assert.deepEqual(await readdir(directory), []);
});
