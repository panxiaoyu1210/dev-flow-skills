import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acceptPhaseHandoff,
  applyImpact,
  buildMinimalContext,
  commitTransition,
  computeImpact,
  consumePhaseResult,
  createAcceptanceResult,
  createPhaseEvaluationResult,
  createPhaseHandoff,
  graphHash,
  planTransition,
  queryNext,
  renderGraphView,
  validateContract,
  SCHEMA_IDS,
} from '../lib/graph/index.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function graphAuthority(graph) {
  graph.authority = {
    mode: 'graph', sourceOfTruth: 'graph', syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true, markdownViewReadableAsAuthority: false,
  };
  return graph;
}

function permit(graph, actorId, resourceRef, effect = 'allow') {
  graph.permissions.push({
    id: `permission.${actorId}.${resourceRef}.${effect}`,
    actorId,
    action: 'transition',
    resourceRef,
    effect,
  });
}

test('impact computes a typed closure, applies stale atomically, and classifies routes', async () => {
  const graph = await fixture('valid-master');
  const preview = computeImpact(graph, { kind: 'requirement', source: 'req.checkout' });
  assert.equal(preview.classification, 'master_replan');
  assert.equal(preview.unknownImpact, false);
  assert.deepEqual(preview.impactedNodeIds, ['req.checkout', 'task.checkout', 'test.checkout']);
  assert.deepEqual(preview.relations.map((item) => item.relationType), ['implements', 'verifies']);

  const applied = applyImpact(graph, { kind: 'file', source: 'src/checkout.mjs' });
  assert.equal(applied.classification, 'within_phase_repair');
  assert.equal(applied.graph.revision, graph.revision + 1);
  assert.equal(applied.graph.nodes.find((node) => node.id === 'task.checkout').status, 'stale');
  assert.equal(graph.nodes.find((node) => node.id === 'task.checkout').status, 'planned');
});

test('impact reports unmatched, external, glob, and missing handoff sources as unknown', async () => {
  const graph = await fixture('valid-master');
  for (const [kind, source] of [
    ['file', 'src/missing.mjs'],
    ['file', 'src/**/*.mjs'],
    ['artifact', 'https://external.example/spec'],
    ['requirement', 'handoff:missing'],
  ]) {
    const result = computeImpact(graph, { kind, source });
    assert.equal(result.classification, 'unknown_impact', `${kind}:${source}`);
    assert.equal(result.unknownImpact, true);
    assert.equal(result.route.owner, 'loop-controller');
    assert.equal(result.route.action, 'conservative_review');
  }
});

test('depends_on stores dependent-to-prerequisite and propagates impact downstream', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.id === 'gate.checkout').status = 'passed';
  graph.nodes.find((node) => node.id === 'task.checkout').status = 'complete';
  graph.nodes.push({
    id: 'task.receipt', type: 'Task', status: 'planned', owner: 'implementation',
    actorId: 'maker.receipt', reviewerActorId: 'reviewer.receipt', files: ['src/receipt.mjs'],
  });
  graph.edges.push({ id: 'edge.receipt-depends-checkout', type: 'depends_on', from: 'task.receipt', to: 'task.checkout' });
  const impact = computeImpact(graph, { kind: 'task', source: 'task.checkout' });
  assert.deepEqual(impact.impactedNodeIds, ['task.checkout', 'task.receipt']);
  assert.deepEqual(queryNext(graph).eligibleTasks, ['task.receipt']);
});

test('next returns eligible and blocked Master tasks with stable reasons', async () => {
  const blockedGraph = await fixture('valid-master');
  const blocked = queryNext(blockedGraph);
  assert.equal(blocked.owner, 'checker');
  assert.equal(blocked.action, 'evaluate_gate');
  assert.deepEqual(blocked.eligibleTasks, ['task.checkout']);
  assert.deepEqual(blocked.blockedTasks, []);

  blockedGraph.nodes.find((node) => node.id === 'gate.checkout').status = 'passed';
  const eligible = queryNext(blockedGraph);
  assert.equal(eligible.owner, 'implementation');
  assert.equal(eligible.action, 'execute_task');
  assert.deepEqual(eligible.eligibleTasks, ['task.checkout']);
  assert.deepEqual(eligible.blockedTasks, []);
});

test('next governs Loop baseline, phase, envelope, budget, and eval independently', async () => {
  const graph = await fixture('valid-loop');
  graph.authority = {
    mode: 'graph', sourceOfTruth: 'graph', syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true, markdownViewReadableAsAuthority: false,
  };
  assert.deepEqual(queryNext(graph).eligiblePhases, ['phase.checkout']);
  graph.nodes.find((node) => node.type === 'Budget').status = 'exhausted';
  const blocked = queryNext(graph);
  assert.equal(blocked.action, 'stop_budget_exhausted');
  assert.deepEqual(blocked.blockedPhases, [{ nodeId: 'phase.checkout', reasons: ['budget_exhausted:budget.checkout'] }]);
});

test('context is schema-valid and excludes unrelated nodes while retaining direct governance context', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.id === 'gate.checkout').status = 'passed';
  graph.nodes.find((node) => node.id === 'task.checkout').relatedNodeIds = ['gate.checkout'];
  graph.nodes.push({ id: 'failure.unrelated', type: 'Failure', status: 'resolved', summary: 'unrelated' });
  const context = buildMinimalContext(graph, { nodeId: 'task.checkout' });
  assert.equal(validateContract(context, SCHEMA_IDS.context).valid, true);
  assert.deepEqual(context.selectedNodeIds, ['task.checkout']);
  assert.deepEqual(context.nodeSummaries.map((node) => node.id), [
    'evidence.checkout', 'gate.checkout', 'req.checkout', 'task.checkout', 'test.checkout',
  ]);
  assert.ok(!context.nodeSummaries.some((node) => node.id === 'failure.unrelated'));
  assert.deepEqual(context.evidenceSummaries.map((item) => item.evidenceId), ['evidence.checkout']);
});

test('transition rejects jumps, gate bypass, stale evidence, missing grants, and explicit deny', async () => {
  const base = await fixture('valid-master');
  await assert.rejects(
    commitTransition({ graph: base, nodeId: 'task.checkout', toStatus: 'in_progress', actorId: 'maker.checkout' }),
    (error) => error.exitCode === 3 && error.code === 'ILLEGAL_TRANSITION',
  );

  const gate = clone(base);
  gate.nodes.find((node) => node.id === 'evidence.checkout').status = 'stale';
  await assert.rejects(
    commitTransition({ graph: gate, nodeId: 'gate.checkout', toStatus: 'passed', actorId: 'checker.checkout' }),
    (error) => error.exitCode === 3 && error.findings.some((item) => item.code === 'evidence_required'),
  );

  const noGrant = clone(base);
  noGrant.permissions = [];
  await assert.rejects(
    commitTransition({ graph: noGrant, nodeId: 'gate.checkout', toStatus: 'passed', actorId: 'checker.checkout' }),
    (error) => error.exitCode === 3 && error.findings.some((item) => item.code === 'permission_denied'),
  );

  const denied = clone(base);
  permit(denied, 'checker.checkout', 'gate.checkout', 'deny');
  await assert.rejects(
    commitTransition({ graph: denied, nodeId: 'gate.checkout', toStatus: 'passed', actorId: 'checker.checkout' }),
    (error) => error.exitCode === 3 && error.findings.some((item) => item.code === 'permission_denied'),
  );
});

test('capability exception is scoped audit metadata after an explicit grant', async () => {
  const graph = await fixture('valid-master');
  graph.permissions = [];
  assert.throws(
    () => planTransition(graph, { nodeId: 'task.checkout', toStatus: 'ready', actorId: 'subagent.checkout' }),
    (error) => error.exitCode === 3,
  );
  permit(graph, 'subagent.checkout', 'task.checkout');
  const result = planTransition(graph, {
    nodeId: 'task.checkout',
    toStatus: 'ready',
    actorId: 'subagent.checkout',
    capabilityException: {
      kind: 'capability_exception',
      actorId: 'subagent.checkout',
      action: 'transition',
      resourceRef: 'task.checkout',
      reason: 'Configured runtime cannot spawn the requested actor.',
    },
  });
  assert.equal(result.graph.nodes.find((node) => node.id === 'task.checkout').status, 'ready');
});

test('illegal transition preserves graph bytes, revision, and rendered view bytes', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-transition-illegal-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graph = await fixture('valid-master');
  const graphPath = path.join(directory, 'graph.json');
  const viewPath = path.join(directory, 'graph.md');
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  await writeFile(viewPath, renderGraphView(graph));
  const beforeGraph = await readFile(graphPath);
  const beforeView = await readFile(viewPath);

  await assert.rejects(
    commitTransition({
      graph, graphPath, viewPath, runtimeDirectory: path.join(directory, 'runtime'),
      nodeId: 'task.checkout', toStatus: 'in_progress', actorId: 'maker.checkout',
    }),
    (error) => error.exitCode === 3,
  );
  assert.deepEqual(await readFile(graphPath), beforeGraph);
  assert.deepEqual(await readFile(viewPath), beforeView);
  assert.equal(graph.revision, 1);
});

test('legal transition writes raw event first, graph atomically, and a deterministic Graph view', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-transition-legal-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graph = await fixture('valid-master');
  const graphPath = path.join(directory, 'graph.json');
  const viewPath = path.join(directory, 'graph.md');
  const runtimeDirectory = path.join(directory, 'runtime');
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  const result = await commitTransition({
    graph, graphPath, viewPath, runtimeDirectory,
    nodeId: 'gate.checkout', toStatus: 'passed', actorId: 'checker.checkout',
    eventId: 'event.gate-pass', occurredAt: '2026-07-24T10:00:00.000Z',
  });
  assert.equal(result.graph.revision, 2);
  assert.equal(result.graph.nodes.find((node) => node.id === 'gate.checkout').status, 'passed');
  assert.equal(result.eventRef.id, 'event.gate-pass');
  await access(path.join(runtimeDirectory, 'event.gate-pass.json'));
  assert.equal(await readFile(viewPath, 'utf8'), renderGraphView(result.graph));
});

test('Loop-to-Master handoff and Master-to-Loop acceptance preserve graph separation', async () => {
  const loop = graphAuthority(await fixture('valid-loop'));
  const master = await fixture('valid-master');
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.checkout', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.equal(validateContract(handoff, SCHEMA_IDS.phaseHandoff).valid, true);
  assert.equal(Object.hasOwn(handoff, 'taskIds'), false);
  const admission = acceptPhaseHandoff(handoff, loop, master);
  assert.equal(admission.accepted, true);

  const admittedMaster = admission.masterGraph;
  admittedMaster.nodes.find((node) => node.type === 'Task').status = 'complete';
  admittedMaster.nodes.find((node) => node.type === 'Requirement').status = 'complete';
  admittedMaster.nodes.find((node) => node.type === 'Test').status = 'passed';
  admittedMaster.nodes.find((node) => node.type === 'Gate').status = 'passed';
  admittedMaster.nodes.find((node) => node.type === 'Git').status = 'complete';
  const readyHandoff = createPhaseHandoff(loop, admittedMaster, {
    handoffId: 'handoff.checkout.ready', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:30:00.000Z',
  });
  const readyMaster = acceptPhaseHandoff(readyHandoff, loop, admittedMaster).masterGraph;
  const acceptance = createAcceptanceResult(readyMaster, loop, readyHandoff, {
    resultId: 'result.checkout', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.equal(validateContract(acceptance, SCHEMA_IDS.phaseResult).valid, true);
  const evaluation = consumePhaseResult(loop, readyMaster, readyHandoff, acceptance);
  assert.equal(evaluation.action, 'next_phase');
  assert.equal(evaluation.phaseId, 'phase.checkout');
  const phaseEval = createPhaseEvaluationResult(loop, readyMaster, readyHandoff, acceptance, {
    resultId: 'phase-eval.checkout', issuedAt: '2026-07-24T11:05:00.000Z',
  });
  assert.equal(validateContract(phaseEval, SCHEMA_IDS.phaseResult).valid, true);
  assert.equal(phaseEval.direction, 'loop_internal');
});

test('handoff rejects graph kind/id/hash/schemaVersion and phase/baseline mismatches', async () => {
  const loop = graphAuthority(await fixture('valid-loop'));
  const master = await fixture('valid-master');
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.checkout', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const mutations = [
    (value) => { value.fromGraph.kind = 'master'; },
    (value) => { value.fromGraph.id = 'loop.other'; },
    (value) => { value.fromGraph.hash = 'f'.repeat(64); },
    (value) => { value.fromGraph.schemaVersion = '9.0.0'; },
    (value) => { value.phaseId = 'phase.other'; },
    (value) => { value.phaseHash = 'd'.repeat(64); },
    (value) => { value.baselineHash = 'e'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const invalid = clone(handoff);
    mutate(invalid);
    assert.throws(() => acceptPhaseHandoff(invalid, loop, master), (error) => error.exitCode === 3);
  }
  assert.equal(handoff.fromGraph.hash, graphHash(loop));
});
