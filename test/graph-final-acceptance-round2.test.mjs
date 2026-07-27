import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  SCHEMA_IDS,
  acceptPhaseHandoff,
  applyImpact,
  buildMinimalContext,
  checkGraph,
  computeImpact,
  createAcceptanceResult,
  createPhaseHandoff,
  planTransition,
  queryNext,
  validateContract,
} from '../lib/graph/index.mjs';

const cli = new URL('../bin/dev-flow.mjs', import.meta.url).pathname;

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function permit(graph, actorId, resourceRef) {
  graph.permissions.push({
    id: `permission.${actorId}.${resourceRef}`,
    actorId,
    action: 'transition',
    resourceRef,
    effect: 'allow',
  });
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

function graphAuthority(graph) {
  graph.authority = {
    mode: 'graph', sourceOfTruth: 'graph', syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true, markdownViewReadableAsAuthority: false,
  };
  return graph;
}

function readyLoop(loop) {
  graphAuthority(loop);
  loop.nodes.find((node) => node.type === 'Goal').status = 'active';
  loop.nodes.find((node) => node.type === 'Phase').status = 'ready';
  loop.nodes.find((node) => node.type === 'Baseline').status = 'passed';
  loop.nodes.find((node) => node.type === 'Envelope').status = 'passed';
  loop.nodes.find((node) => node.type === 'Budget').status = 'active';
  return loop;
}

test('queryNext target/blocker protocol is stable and drives CLI plus context', async (t) => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.type === 'Task').status = 'complete';
  graph.nodes.find((node) => node.type === 'Evidence').status = 'stale';
  const next = queryNext(graph);
  assert.equal(next.action, 'repair_gate_prerequisites');
  assert.deepEqual(next.targetNodeIds, ['gate.checkout']);
  assert.equal(next.blocked, false);
  assert.ok(next.blockers.some((blocker) => blocker.code === 'prerequisite_not_satisfied'
    && blocker.nodeId === 'gate.checkout'
    && blocker.relatedNodeIds.includes('evidence.checkout')));

  const reordered = structuredClone(graph);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  reordered.permissions.reverse();
  assert.deepEqual(queryNext(reordered), next);

  const context = buildMinimalContext(graph);
  assert.deepEqual(context.selectedNodeIds, next.targetNodeIds);
  assert.deepEqual(context.reasonCodes, next.blockers.map((blocker) => blocker.code));
  assert.ok(context.nodeSummaries.some((node) => node.id === 'gate.checkout'));
  assert.ok(context.nodeSummaries.some((node) => node.id === 'evidence.checkout'));

  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-round2-next-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graphPath = path.join(directory, 'graph.json');
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  const json = run(directory, 'graph', 'next', '--graph', graphPath, '--json');
  assert.equal(json.status, 0, `${json.stdout} ${json.stderr}`);
  assert.deepEqual(JSON.parse(json.stdout).data.targetNodeIds, next.targetNodeIds);
  assert.deepEqual(JSON.parse(json.stdout).data.blockers, next.blockers);
  const human = run(directory, 'graph', 'next', '--graph', graphPath);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /"targetNodeIds": \[/);
  assert.match(human.stdout, /"blockers": \[/);
});

test('minimal context follows next targets for active and repair actions', async () => {
  const cases = [];

  const activeTask = await fixture('valid-master');
  activeTask.nodes.find((node) => node.type === 'Gate').status = 'passed';
  activeTask.nodes.find((node) => node.type === 'Task').status = 'in_progress';
  cases.push([activeTask, 'continue_task', 'task.checkout']);

  const failure = await fixture('valid-master');
  failure.nodes.find((node) => node.type === 'Failure').status = 'active';
  cases.push([failure, 'resolve_failure', 'failure.checkout']);

  const git = await fixture('valid-master');
  git.nodes.find((node) => node.type === 'Git').status = 'stale';
  cases.push([git, 'repair_git_state', 'git.checkout']);

  const testGraph = readyMaster(await fixture('valid-master'));
  testGraph.nodes.find((node) => node.type === 'Requirement').status = 'ready';
  testGraph.nodes.find((node) => node.type === 'Test').status = 'ready';
  cases.push([testGraph, 'run_test', 'test.checkout']);

  const requirement = readyMaster(await fixture('valid-master'));
  requirement.nodes.find((node) => node.type === 'Requirement').status = 'ready';
  cases.push([requirement, 'complete_requirement', 'req.checkout']);

  const evidence = readyMaster(await fixture('valid-master'));
  evidence.nodes.find((node) => node.type === 'Evidence').status = 'stale';
  cases.push([evidence, 'refresh_evidence', 'evidence.checkout']);

  const activePhase = readyLoop(await fixture('valid-loop'));
  activePhase.nodes.find((node) => node.type === 'Phase').status = 'active';
  cases.push([activePhase, 'continue_phase', 'phase.checkout']);

  const evaluation = readyLoop(await fixture('valid-loop'));
  evaluation.nodes.find((node) => node.type === 'Phase').status = 'complete';
  evaluation.nodes.find((node) => node.type === 'Eval').status = 'pending';
  cases.push([evaluation, 'evaluate_phase', 'eval.checkout']);

  for (const [graph, action, targetId] of cases) {
    const next = queryNext(graph);
    assert.equal(next.action, action);
    assert.deepEqual(next.targetNodeIds, [targetId]);
    const context = buildMinimalContext(graph);
    assert.deepEqual(context.selectedNodeIds, [targetId]);
    assert.ok(context.nodeSummaries.some((node) => node.id === targetId), action);
    assert.ok(context.refs.length > 0, action);
    assert.ok(context.reasonCodes.length > 0, action);
  }
});

test('downstream Gate dependency paths never deadlock their prerequisite Task', async () => {
  for (const variant of ['direct', 'depends_on', 'transitive', 'control']) {
    const graph = await fixture('valid-master');
    const task = graph.nodes.find((node) => node.type === 'Task');
    const gate = graph.nodes.find((node) => node.type === 'Gate');
    task.relatedNodeIds = [gate.id];
    gate.prerequisiteIds = [];
    if (variant === 'direct') gate.prerequisiteIds = [task.id];
    if (variant === 'depends_on') graph.edges.push({
      id: 'edge.gate-depends-task', type: 'depends_on', from: gate.id, to: task.id,
    });
    if (variant === 'transitive') {
      const verification = graph.nodes.find((node) => node.type === 'Test');
      gate.prerequisiteIds = [verification.id];
      graph.edges.push({
        id: 'edge.test-depends-task', type: 'depends_on', from: verification.id, to: task.id,
      });
    }
    if (variant === 'control') graph.edges.push({
      id: 'edge.task-controls-gate', type: 'control', from: task.id, to: gate.id,
    });

    assert.deepEqual(queryNext(graph).targetNodeIds, [task.id], variant);
    task.status = 'in_progress';
    graph.nodes.find((node) => node.type === 'Test').status = 'passed';
    permit(graph, 'task.owner', task.id);
    assert.equal(planTransition(graph, {
      nodeId: task.id, toStatus: 'complete', actorId: 'task.owner',
    }).toStatus, 'complete', variant);
  }
});

test('a related non-downstream Gate remains a Task completion prerequisite', async () => {
  const graph = await fixture('valid-master');
  const task = graph.nodes.find((node) => node.type === 'Task');
  task.relatedNodeIds = ['gate.checkout'];
  assert.deepEqual(queryNext(graph).blockedTasks, [{
    nodeId: task.id, reasons: ['gate_not_passed:gate.checkout'],
  }]);
  task.status = 'in_progress';
  graph.nodes.find((node) => node.type === 'Test').status = 'passed';
  permit(graph, 'task.owner', task.id);
  assert.throws(
    () => planTransition(graph, { nodeId: task.id, toStatus: 'complete', actorId: 'task.owner' }),
    (error) => error.findings.some((finding) => finding.code === 'gate_required'),
  );
});

test('Loop controls and related Evals gate both next and phase handoff', async () => {
  for (const type of ['Goal', 'Baseline', 'Envelope', 'Budget']) {
    const loop = readyLoop(await fixture('valid-loop'));
    loop.nodes = loop.nodes.filter((node) => node.type !== type);
    const next = queryNext(loop);
    assert.equal(next.action, 'repair_loop_controls', type);
    assert.equal(next.blocked, false, type);
    assert.deepEqual(next.eligiblePhases, [], type);
    assert.ok(next.blockers.some((blocker) => blocker.code === `missing_${type.toLowerCase()}_control`), type);
  }

  const loop = readyLoop(await fixture('valid-loop'));
  const master = await fixture('valid-master');
  const phase = loop.nodes.find((node) => node.type === 'Phase');
  const evaluation = loop.nodes.find((node) => node.type === 'Eval');
  phase.relatedNodeIds = [evaluation.id];
  for (const status of ['pending', 'stale', 'failed']) {
    evaluation.status = status;
    const next = queryNext(loop);
    assert.notEqual(next.action, 'handoff_phase', status);
    assert.deepEqual(next.eligiblePhases, [], status);
    assert.ok(next.blockers.some((blocker) => blocker.nodeId === evaluation.id), status);
    assert.throws(
      () => createPhaseHandoff(loop, master, {
        handoffId: `handoff.eval-${status}`, phaseId: phase.id, issuedAt: '2026-07-24T10:00:00.000Z',
      }),
      (error) => error.exitCode === 3,
      status,
    );
  }
  evaluation.status = 'passed';
  const next = queryNext(loop);
  assert.equal(next.action, 'handoff_phase');
  assert.deepEqual(next.targetNodeIds, [phase.id]);
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.eval-passed', phaseId: phase.id, issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.equal(acceptPhaseHandoff(handoff, loop, master).accepted, true);
});

test('Budget exhaustion has one target/blocker conclusion across next and context', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  loop.nodes.find((node) => node.type === 'Budget').status = 'exhausted';
  const next = queryNext(loop);
  assert.equal(next.action, 'stop_budget_exhausted');
  assert.equal(next.blocked, false);
  assert.deepEqual(next.targetNodeIds, ['budget.checkout']);
  assert.ok(next.blockers.some((blocker) => blocker.code === 'budget_exhausted'
    && blocker.nodeId === 'budget.checkout'));
  const context = buildMinimalContext(loop);
  assert.deepEqual(context.selectedNodeIds, next.targetNodeIds);
  assert.deepEqual(context.reasonCodes, next.blockers.map((blocker) => blocker.code));
  assert.ok(context.nodeSummaries.some((node) => node.id === 'budget.checkout'));
});

test('impact propagates prerequisiteIds from prerequisite to dependent and deduplicates overlap', async () => {
  const graph = await fixture('valid-master');
  const evidence = graph.nodes.find((node) => node.type === 'Evidence');
  evidence.ref = 'runtime/evidence.checkout.json';
  graph.edges = graph.edges.filter((edge) => edge.id !== 'edge.gate-evidence');
  const onlyDeclared = computeImpact(graph, { kind: 'artifact', source: evidence.ref });
  assert.equal(onlyDeclared.unknownImpact, false);
  assert.deepEqual(onlyDeclared.impactedNodeIds, ['evidence.checkout', 'gate.checkout']);
  const applied = applyImpact(graph, { kind: 'artifact', source: evidence.ref });
  assert.equal(applied.graph.nodes.find((node) => node.type === 'Gate').status, 'stale');
  assert.equal((await checkGraph(applied.graph)).valid, true);

  graph.edges.push({ id: 'edge.gate-evidence', type: 'requires', from: 'gate.checkout', to: 'evidence.checkout' });
  const overlapping = computeImpact(graph, { kind: 'artifact', source: evidence.ref });
  assert.equal(overlapping.relations.filter((relation) => relation.to === 'gate.checkout').length, 1);
});

test('empty Requirement scope cannot create a handoff or pass Master acceptance', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const normalMaster = readyMaster(await fixture('valid-master'));
  const normalHandoff = createPhaseHandoff(loop, normalMaster, {
    handoffId: 'handoff.normal-scope', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.equal(validateContract({ ...normalHandoff, requirementRefs: [] }, SCHEMA_IDS.phaseHandoff).valid, false);

  const emptyMaster = structuredClone(normalMaster);
  emptyMaster.nodes = [];
  emptyMaster.edges = [];
  emptyMaster.permissions = [];
  assert.throws(
    () => createPhaseHandoff(loop, emptyMaster, {
      handoffId: 'handoff.empty-scope', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
    }),
    (error) => error.findings.some((finding) => finding.code === 'requirement_scope_missing'),
  );
  assert.throws(
    () => createAcceptanceResult(emptyMaster, loop, normalHandoff, {
      resultId: 'result.empty-scope', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    (error) => error.code === 'loop_baseline_change' && error.route?.action === 'reissue_handoff',
  );

  const uncovered = readyMaster(await fixture('valid-master'));
  uncovered.edges = uncovered.edges.filter((edge) => edge.type !== 'implements');
  const handoff = createPhaseHandoff(loop, uncovered, {
    handoffId: 'handoff.uncovered', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedUncovered = acceptPhaseHandoff(handoff, loop, uncovered).masterGraph;
  assert.throws(
    () => createAcceptanceResult(admittedUncovered, loop, handoff, {
      resultId: 'result.uncovered', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    (error) => error.findings.some((finding) => finding.code === 'acceptance_coverage_gap'),
  );
});
