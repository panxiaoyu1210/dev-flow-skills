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

function graphAuthority(graph) {
  graph.authority = {
    mode: 'graph', sourceOfTruth: 'graph', syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true, markdownViewReadableAsAuthority: false,
  };
  return graph;
}

function readyLoop(loop) {
  graphAuthority(loop);
  loop.nodes.find((node) => node.type === 'Phase').status = 'ready';
  loop.nodes.find((node) => node.type === 'Baseline').status = 'passed';
  loop.nodes.find((node) => node.type === 'Envelope').status = 'passed';
  loop.nodes.find((node) => node.type === 'Budget').status = 'active';
  return loop;
}

function readyMaster(master) {
  master.nodes.find((node) => node.type === 'Requirement').status = 'complete';
  master.nodes.find((node) => node.type === 'Task').status = 'complete';
  master.nodes.find((node) => node.type === 'Test').status = 'passed';
  master.nodes.find((node) => node.type === 'Gate').status = 'passed';
  master.nodes.find((node) => node.type === 'Git').status = 'complete';
  master.nodes.find((node) => node.type === 'Failure').status = 'resolved';
  return master;
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

test('passing acceptance requires every Requirement to be complete', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  for (const status of ['ready', 'active', 'stale', 'blocked']) {
    const master = readyMaster(await fixture('valid-master'));
    master.nodes.find((node) => node.type === 'Requirement').status = status;
    const handoff = createPhaseHandoff(loop, master, {
      handoffId: `handoff.requirement-${status}`,
      phaseId: 'phase.checkout',
      issuedAt: '2026-07-24T10:00:00.000Z',
    });
    const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
    assert.throws(
      () => createAcceptanceResult(admittedMaster, loop, handoff, {
        resultId: `result.requirement-${status}`,
        outcome: 'passed',
        issuedAt: '2026-07-24T11:00:00.000Z',
      }),
      (error) => error.exitCode === 3
        && error.findings.some((finding) => finding.code === 'acceptance_not_ready'
          && finding.rule === 'acceptance.requirement_ready'
          && finding.nodeIds.includes('req.checkout')),
    );
  }
  const complete = readyMaster(await fixture('valid-master'));
  complete.nodes.find((node) => node.type === 'Requirement').status = 'complete';
  const handoff = createPhaseHandoff(loop, complete, {
    handoffId: 'handoff.requirement-complete', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedComplete = acceptPhaseHandoff(handoff, loop, complete).masterGraph;
  assert.equal(createAcceptanceResult(admittedComplete, loop, handoff, {
    resultId: 'result.requirement-complete', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  }).outcome, 'passed');
});

test('next routes blocked and actionable Gates, Evals, and active work without false workflow blocking', async () => {
  const blockedGateGraph = await fixture('valid-master');
  blockedGateGraph.nodes.find((node) => node.type === 'Task').status = 'complete';
  blockedGateGraph.nodes.find((node) => node.type === 'Evidence').status = 'stale';
  const blockedGate = queryNext(blockedGateGraph);
  assert.equal(blockedGate.action, 'repair_gate_prerequisites');
  assert.equal(blockedGate.blocked, false);
  assert.deepEqual(blockedGate.blockedGates, [{
    nodeId: 'gate.checkout', reasons: ['prerequisite_not_satisfied:evidence.checkout'],
  }]);

  const actionableGateGraph = await fixture('valid-master');
  actionableGateGraph.nodes.find((node) => node.type === 'Task').relatedNodeIds = ['gate.checkout'];
  const actionableGate = queryNext(actionableGateGraph);
  assert.equal(actionableGate.action, 'evaluate_gate');
  assert.equal(actionableGate.blocked, false);
  assert.deepEqual(actionableGate.blockedTasks, [{
    nodeId: 'task.checkout', reasons: ['gate_not_passed:gate.checkout'],
  }]);

  const activeGraph = await fixture('valid-master');
  activeGraph.nodes.find((node) => node.type === 'Task').status = 'in_progress';
  activeGraph.nodes.find((node) => node.type === 'Gate').status = 'passed';
  const active = queryNext(activeGraph);
  assert.equal(active.action, 'continue_task');
  assert.equal(active.blocked, false);

  const loop = readyLoop(await fixture('valid-loop'));
  loop.nodes.find((node) => node.type === 'Phase').status = 'complete';
  loop.nodes.find((node) => node.type === 'Eval').status = 'pending';
  const evaluation = queryNext(loop);
  assert.equal(evaluation.action, 'evaluate_phase');
  assert.equal(evaluation.blocked, false);
});

test('impact stale propagation remains schema-valid for every affected control node type', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const loopRoutes = {
    Goal: ['repair_goal', 'complete'],
    Budget: ['restore_budget', 'exhausted'],
    Eval: ['repair_phase_eval', 'passed'],
  };
  for (const type of ['Goal', 'Budget', 'Eval']) {
    const graph = structuredClone(loop);
    const node = graph.nodes.find((item) => item.type === type);
    if (type === 'Eval') graph.nodes.find((item) => item.type === 'Phase').relatedNodeIds = [node.id];
    const applied = applyImpact(graph, { kind: 'artifact', source: node.ref });
    assert.equal(applied.graph.nodes.find((item) => item.id === node.id).status, 'stale', type);
    assert.equal((await checkGraph(applied.graph)).valid, true, type);
    assert.equal(queryNext(applied.graph).action, loopRoutes[type][0], type);
    permit(applied.graph, 'recovery.owner', node.id);
    assert.throws(
      () => planTransition(applied.graph, {
        nodeId: node.id, toStatus: loopRoutes[type][1], actorId: 'recovery.owner',
      }),
      (error) => error.findings.some((finding) => finding.code === 'illegal_transition'),
      type,
    );
  }

  const master = await fixture('valid-master');
  master.nodes.find((node) => node.type === 'Failure').ref = 'runtime/failure.json';
  const masterRoutes = {
    Git: ['repair_git_state', 'complete'],
    Failure: ['resolve_failure', 'resolved'],
  };
  for (const type of ['Git', 'Failure']) {
    const graph = structuredClone(master);
    const node = graph.nodes.find((item) => item.type === type);
    const applied = applyImpact(graph, { kind: 'artifact', source: node.ref });
    assert.equal(applied.graph.nodes.find((item) => item.id === node.id).status, 'stale', type);
    assert.equal((await checkGraph(applied.graph)).valid, true, type);
    assert.equal(queryNext(applied.graph).action, masterRoutes[type][0], type);
    permit(applied.graph, 'recovery.owner', node.id);
    assert.throws(
      () => planTransition(applied.graph, {
        nodeId: node.id, toStatus: masterRoutes[type][1], actorId: 'recovery.owner',
      }),
      (error) => error.findings.some((finding) => finding.code === 'illegal_transition'),
      type,
    );
  }
});

test('DAG cycle detection includes prerequisiteIds without duplicate findings', async () => {
  const graph = await fixture('valid-loop');
  graph.nodes.find((node) => node.id === 'phase.checkout').prerequisiteIds = ['phase.second'];
  graph.nodes.push({
    id: 'phase.second', type: 'Phase', status: 'ready',
    ref: 'Docs/checkout/loop/loop-phase-dag.md#phase-2',
    hash: '8888888888888888888888888888888888888888888888888888888888888888',
    prerequisiteIds: ['phase.checkout'],
  });
  const result = await checkGraph(graph);
  assert.equal(result.findings.filter((finding) => finding.code === 'dag_cycle').length, 1);
  assert.deepEqual(result.findings.find((finding) => finding.code === 'dag_cycle').nodeIds, ['phase.checkout', 'phase.second']);
});

test('permission conflicts include wildcard and concrete resource overlap', async () => {
  const graph = await fixture('valid-master');
  graph.permissions.push(
    { id: 'permission.wildcard', actorId: 'maker.checkout', action: 'transition', resourceRef: '*', effect: 'allow' },
    { id: 'permission.specific-deny', actorId: 'maker.checkout', action: 'transition', resourceRef: 'task.checkout', effect: 'deny' },
  );
  const result = await checkGraph(graph);
  assert.ok(result.findings.some((finding) => finding.code === 'permission_conflict'));
});

test('Loop terminal transitions enforce Goal scope and Phase-specific Eval relations', async () => {
  const goalGraph = readyLoop(await fixture('valid-loop'));
  const goal = goalGraph.nodes.find((node) => node.type === 'Goal');
  const phase = goalGraph.nodes.find((node) => node.type === 'Phase');
  const evaluation = goalGraph.nodes.find((node) => node.type === 'Eval');
  phase.relatedNodeIds = [evaluation.id];
  permit(goalGraph, 'goal.owner', goal.id);
  assert.throws(
    () => planTransition(goalGraph, { nodeId: goal.id, toStatus: 'complete', actorId: 'goal.owner' }),
    (error) => error.findings.some((finding) => finding.code === 'phase_incomplete'),
  );
  phase.status = 'complete';
  evaluation.status = 'pending';
  assert.throws(
    () => planTransition(goalGraph, { nodeId: goal.id, toStatus: 'complete', actorId: 'goal.owner' }),
    (error) => error.findings.some((finding) => finding.code === 'phase_eval_required'),
  );
  evaluation.status = 'passed';
  assert.equal(planTransition(goalGraph, {
    nodeId: goal.id, toStatus: 'complete', actorId: 'goal.owner',
  }).toStatus, 'complete');
  const missingControl = structuredClone(goalGraph);
  missingControl.nodes = missingControl.nodes.filter((node) => node.type !== 'Budget');
  assert.throws(
    () => planTransition(missingControl, { nodeId: goal.id, toStatus: 'complete', actorId: 'goal.owner' }),
    (error) => error.findings.some((finding) => finding.code === 'missing_budget_control'),
  );

  const phaseGraph = readyLoop(await fixture('valid-loop'));
  const phaseOne = phaseGraph.nodes.find((node) => node.type === 'Phase');
  const evalOne = phaseGraph.nodes.find((node) => node.type === 'Eval');
  phaseOne.status = 'active';
  phaseOne.relatedNodeIds = [evalOne.id];
  evalOne.status = 'passed';
  phaseGraph.nodes.push(
    {
      id: 'phase.future', type: 'Phase', status: 'ready', ref: 'Docs/future#phase',
      hash: '9999999999999999999999999999999999999999999999999999999999999999',
      relatedNodeIds: ['eval.future'],
    },
    {
      id: 'eval.future', type: 'Eval', status: 'pending', ref: 'Docs/future#eval',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      relatedNodeIds: ['phase.future'],
    },
  );
  permit(phaseGraph, 'phase.owner', phaseOne.id);
  assert.equal(planTransition(phaseGraph, {
    nodeId: phaseOne.id, toStatus: 'complete', actorId: 'phase.owner',
  }).toStatus, 'complete');

  const missingRelation = readyLoop(await fixture('valid-loop'));
  const missingRelationPhase = missingRelation.nodes.find((node) => node.type === 'Phase');
  missingRelationPhase.status = 'active';
  delete missingRelationPhase.relatedNodeIds;
  permit(missingRelation, 'phase.owner', 'phase.checkout');
  assert.throws(
    () => planTransition(missingRelation, { nodeId: 'phase.checkout', toStatus: 'complete', actorId: 'phase.owner' }),
    (error) => error.findings.some((finding) => finding.code === 'phase_eval_relation_missing'),
  );
});

test('unsupported CLI impact kind is a validation envelope', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-final-kind-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graphPath = path.join(directory, 'graph.json');
  await writeFile(graphPath, `${JSON.stringify(await fixture('valid-master'))}\n`);
  const result = run(directory, 'graph', 'impact', '--graph', graphPath, '--kind', 'bogus', '--source', 'x', '--json');
  assert.equal(result.status, 2, `${result.stdout} ${result.stderr}`);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error.code, 'cli_syntax_invalid');
  assert.equal(envelope.error.findings[0].path, '/flags/kind');
});

test('default blocked context selects the minimal blocker governance closure', async () => {
  const graph = await fixture('valid-master');
  const task = graph.nodes.find((node) => node.type === 'Task');
  task.relatedNodeIds = ['gate.checkout'];
  const context = buildMinimalContext(graph);
  assert.equal(validateContract(context, SCHEMA_IDS.context).valid, true);
  assert.deepEqual(context.selectedNodeIds, ['gate.checkout']);
  assert.deepEqual(context.blockedNodeIds, []);
  assert.ok(context.reasonCodes.includes('next_action:evaluate_gate'));
  assert.ok(context.nodeSummaries.some((node) => node.id === 'gate.checkout'));
  assert.ok(context.nodeSummaries.some((node) => node.id === 'evidence.checkout'));
  assert.deepEqual(context.evidenceSummaries.map((item) => item.evidenceId), ['evidence.checkout']);
  assert.ok(!context.nodeSummaries.some((node) => node.id === 'failure.checkout'));
});
