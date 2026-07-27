import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acceptPhaseHandoff,
  consumePhaseResult,
  createAcceptanceResult,
  createPhaseHandoff,
  graphHash,
  phaseResultHash,
  readMarkdownProjection,
  writeGraphFile,
} from '../lib/graph/index.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

function graphAuthority(graph) {
  graph.authority = {
    mode: 'graph', sourceOfTruth: 'graph', syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true, markdownViewReadableAsAuthority: false,
  };
  return graph;
}

function readyLoop(loop) {
  graphAuthority(loop);
  const phase = loop.nodes.find((node) => node.id === 'phase.checkout');
  phase.status = 'ready';
  phase.relatedNodeIds = [
    'goal.checkout', 'baseline.checkout', 'envelope.checkout', 'budget.checkout', 'eval.checkout',
  ];
  loop.nodes.find((node) => node.id === 'goal.checkout').status = 'active';
  loop.nodes.find((node) => node.id === 'baseline.checkout').status = 'passed';
  loop.nodes.find((node) => node.id === 'envelope.checkout').status = 'passed';
  loop.nodes.find((node) => node.id === 'budget.checkout').status = 'active';
  loop.nodes.find((node) => node.id === 'eval.checkout').status = 'passed';
  return loop;
}

function readyMaster(master) {
  master.nodes.find((node) => node.type === 'Requirement').status = 'complete';
  master.nodes.find((node) => node.type === 'Task').status = 'complete';
  master.nodes.find((node) => node.type === 'Test').status = 'passed';
  master.nodes.find((node) => node.type === 'Gate').status = 'passed';
  master.nodes.find((node) => node.type === 'Evidence').status = 'passed';
  master.nodes.find((node) => node.type === 'Git').status = 'complete';
  master.nodes.find((node) => node.type === 'Failure').status = 'resolved';
  return master;
}

function graphProjection(graph) {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    permissions: graph.permissions,
    ...(graph.graphKind === 'master' ? { handoffReceipts: graph.handoffReceipts } : {}),
  };
}

function markdown(projection) {
  return `# Authority\n\n\`\`\`dev-flow-graph\n${JSON.stringify(projection)}\n\`\`\`\n`;
}

async function shadowGraph(graph, sourcePath, sourceRoot) {
  await writeFile(sourcePath, markdown(graphProjection(graph)));
  const snapshot = await readMarkdownProjection([path.basename(sourcePath)], { sourceRoot });
  const shadow = structuredClone(graph);
  shadow.authority = {
    mode: 'shadow', sourceOfTruth: 'markdown', syncDirection: 'markdown_to_graph',
    graphMutationAllowed: false, markdownViewReadableAsAuthority: true,
    markdownSources: snapshot.markdownSources,
  };
  return shadow;
}

function noTemporaryFiles(entries, destination) {
  const prefix = `.${path.basename(destination)}.`;
  return entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.tmp'));
}

test('generic writer cannot overwrite Shadow and leaves target plus temp state untouched', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-writer-round8-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'authority.md');
  const target = path.join(directory, 'shadow.json');
  const shadow = await shadowGraph(readyMaster(await fixture('valid-master')), sourcePath, directory);
  const original = '{"sentinel":true}\n';
  await writeFile(target, original);

  await assert.rejects(
    writeGraphFile(target, shadow, { sourceRoot: directory }),
    (error) => error.exitCode === 3 && error.code === 'shadow_read_only'
      && error.route?.action === 'update_shadow_projection_and_snapshot',
  );
  assert.equal(await readFile(target, 'utf8'), original);
  assert.deepEqual(noTemporaryFiles(await readdir(directory), target), []);
});

test('exclusive Shadow snapshot revalidates current source and never accepts a witness shortcut', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-exclusive-round8-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'authority.md');
  const shadow = await shadowGraph(readyMaster(await fixture('valid-master')), sourcePath, directory);

  const exactTarget = path.join(directory, 'exact.json');
  await writeGraphFile(exactTarget, shadow, { exclusive: true, sourceRoot: directory });
  assert.deepEqual(JSON.parse(await readFile(exactTarget, 'utf8')), shadow);

  await unlink(sourcePath);
  const missingTarget = path.join(directory, 'missing.json');
  await assert.rejects(
    writeGraphFile(missingTarget, shadow, {
      exclusive: true, sourceRoot: directory, shadowVerified: true,
    }),
    (error) => ['shadow_drift', 'GRAPH_VALIDATION_FAILED'].includes(error.code),
  );
  await assert.rejects(readFile(missingTarget, 'utf8'), (error) => error.code === 'ENOENT');
  assert.deepEqual(noTemporaryFiles(await readdir(directory), missingTarget), []);

  await writeFile(sourcePath, markdown({
    ...graphProjection(shadow),
    nodes: shadow.nodes.map((node) => node.id === 'req.checkout' ? { ...node, status: 'stale' } : node),
  }));
  const driftTarget = path.join(directory, 'drift.json');
  await assert.rejects(
    writeGraphFile(driftTarget, shadow, { exclusive: true, sourceRoot: directory }),
    (error) => ['shadow_drift', 'GRAPH_VALIDATION_FAILED'].includes(error.code),
  );
  await assert.rejects(readFile(driftTarget, 'utf8'), (error) => error.code === 'ENOENT');
  assert.deepEqual(noTemporaryFiles(await readdir(directory), driftTarget), []);

  await writeFile(sourcePath, '# Authority\n\n```dev-flow-graph\n{invalid-json}\n```\n');
  const invalidTarget = path.join(directory, 'invalid.json');
  await assert.rejects(
    writeGraphFile(invalidTarget, shadow, { exclusive: true, sourceRoot: directory }),
    (error) => ['shadow_drift', 'GRAPH_VALIDATION_FAILED'].includes(error.code),
  );
  await assert.rejects(readFile(invalidTarget, 'utf8'), (error) => error.code === 'ENOENT');
  assert.deepEqual(noTemporaryFiles(await readdir(directory), invalidTarget), []);
});

test('in-memory receipt injection cannot bypass Shadow handoff consumers', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-injection-round8-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loop = readyLoop(await fixture('valid-loop'));
  const initialMaster = readyMaster(await fixture('valid-master'));
  const handoff = createPhaseHandoff(loop, initialMaster, {
    handoffId: 'handoff.shadow-injection-round8', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admission = acceptPhaseHandoff(handoff, loop, initialMaster, {
    actorId: 'master.acceptance', acceptedAt: '2026-07-24T10:01:00.000Z',
  });
  const legitimate = createAcceptanceResult(admission.masterGraph, loop, handoff, {
    resultId: 'result.shadow-injection-round8', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });

  const sourcePath = path.join(directory, 'master.md');
  const shadowWithoutReceipt = await shadowGraph(initialMaster, sourcePath, directory);
  const injected = structuredClone(admission.masterGraph);
  injected.authority = shadowWithoutReceipt.authority;
  const injectedResult = structuredClone(legitimate);
  injectedResult.masterGraph = {
    kind: 'master', id: injected.id, hash: graphHash(injected), schemaVersion: injected.schemaVersion,
  };
  injectedResult.evaluationHash = phaseResultHash(injectedResult);
  const sourceOptions = { sourceRoot: directory };

  for (const operation of [
    () => acceptPhaseHandoff(handoff, loop, injected, sourceOptions),
    () => createAcceptanceResult(injected, loop, handoff, {
      ...sourceOptions, resultId: 'result.injected', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    () => consumePhaseResult(loop, injected, handoff, injectedResult, sourceOptions),
  ]) await assert.rejects(
    async () => operation(),
    (error) => error.exitCode === 3 && error.code === 'shadow_drift',
  );
});

test('exact projected Shadow receipt is consumable and every call rereads current source', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-consumer-round8-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loop = readyLoop(await fixture('valid-loop'));
  const initialMaster = readyMaster(await fixture('valid-master'));
  const handoff = createPhaseHandoff(loop, initialMaster, {
    handoffId: 'handoff.shadow-exact-round8', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admitted = acceptPhaseHandoff(handoff, loop, initialMaster, {
    actorId: 'master.acceptance', acceptedAt: '2026-07-24T10:01:00.000Z',
  }).masterGraph;
  const sourcePath = path.join(directory, 'master.md');
  const shadow = await shadowGraph(admitted, sourcePath, directory);
  const sourceOptions = { sourceRoot: directory };

  assert.equal((await acceptPhaseHandoff(handoff, loop, shadow, sourceOptions)).alreadyAccepted, true);
  const result = await createAcceptanceResult(shadow, loop, handoff, {
    ...sourceOptions, resultId: 'result.shadow-exact-round8', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.equal((await consumePhaseResult(loop, shadow, handoff, result, sourceOptions)).action, 'next_phase');

  await writeFile(sourcePath, markdown({
    ...graphProjection(shadow), handoffReceipts: [],
  }));
  await assert.rejects(
    async () => createAcceptanceResult(shadow, loop, handoff, {
      ...sourceOptions, resultId: 'result.after-race', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    (error) => error.exitCode === 3 && error.code === 'shadow_drift',
  );
});

test('Graph writer retains atomic overwrite behavior', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-graph-writer-round8-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'graph.json');
  const graph = readyMaster(await fixture('valid-master'));
  await writeGraphFile(target, graph, { exclusive: true });
  const updated = structuredClone(graph);
  updated.revision += 1;
  updated.nodes.find((node) => node.id === 'git.checkout').status = 'complete';
  await writeGraphFile(target, updated);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), updated);
  assert.deepEqual(noTemporaryFiles(await readdir(directory), target), []);
});
