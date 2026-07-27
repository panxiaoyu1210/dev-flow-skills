import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SCHEMA_IDS,
  acceptPhaseHandoff,
  buildMinimalContext,
  checkGraph,
  createAcceptanceResult,
  createPhaseHandoff,
  planTransition,
  queryNext,
  validateContract,
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

function loopReadyForHandoff(loop) {
  graphAuthority(loop);
  const phase = loop.nodes.find((node) => node.type === 'Phase');
  const evaluation = loop.nodes.find((node) => node.type === 'Eval');
  loop.nodes.find((node) => node.type === 'Goal').status = 'active';
  loop.nodes.find((node) => node.type === 'Baseline').status = 'passed';
  loop.nodes.find((node) => node.type === 'Envelope').status = 'passed';
  loop.nodes.find((node) => node.type === 'Budget').status = 'active';
  phase.status = 'ready';
  phase.relatedNodeIds = [evaluation.id];
  evaluation.status = 'passed';
  return loop;
}

function masterReady(master) {
  master.nodes.find((node) => node.type === 'Requirement').status = 'complete';
  master.nodes.find((node) => node.type === 'Task').status = 'complete';
  master.nodes.find((node) => node.type === 'Test').status = 'passed';
  master.nodes.find((node) => node.type === 'Gate').status = 'passed';
  master.nodes.find((node) => node.type === 'Evidence').status = 'passed';
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

function addSecondRequirement(master) {
  master.nodes.push(
    {
      id: 'req.second', type: 'Requirement', status: 'complete',
      hash: '1111111111111111111111111111111111111111111111111111111111111111',
      sourceRevision: 'git:abc123',
    },
    {
      id: 'task.second', type: 'Task', status: 'complete', owner: 'implementation',
      actorId: 'maker.second', reviewerActorId: 'reviewer.second', files: ['src/second.mjs'],
    },
    {
      id: 'test.second', type: 'Test', status: 'passed',
      ref: 'test/second.test.mjs#case',
    },
  );
  master.edges.push(
    { id: 'edge.second-task', type: 'implements', from: 'req.second', to: 'task.second' },
    { id: 'edge.second-test', type: 'verifies', from: 'test.second', to: 'req.second' },
  );
  return master;
}

test('Goal complete routes to stable stop_complete or terminal inconsistency', async () => {
  const complete = loopReadyForHandoff(await fixture('valid-loop'));
  complete.nodes.find((node) => node.type === 'Phase').status = 'complete';
  complete.nodes.find((node) => node.type === 'Goal').status = 'complete';
  const expectedIds = complete.nodes.map((node) => node.id).sort();
  const next = queryNext(complete);
  assert.equal(next.action, 'stop_complete');
  assert.equal(next.blocked, false);
  assert.deepEqual(next.targetNodeIds, expectedIds);
  assert.deepEqual(next.blockers, []);
  const context = buildMinimalContext(complete);
  assert.deepEqual(context.selectedNodeIds, expectedIds);
  assert.deepEqual(context.nodeSummaries.map((node) => node.id), expectedIds);

  const reordered = structuredClone(complete);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(queryNext(reordered), next);

  const premature = loopReadyForHandoff(await fixture('valid-loop'));
  premature.nodes.find((node) => node.type === 'Goal').status = 'complete';
  premature.nodes.find((node) => node.type === 'Eval').status = 'pending';
  const inconsistent = queryNext(premature);
  assert.equal(inconsistent.action, 'resolve_terminal_inconsistency');
  assert.ok(inconsistent.blockers.some((blocker) => blocker.code === 'premature_goal_completion'));
  assert.ok((await checkGraph(premature)).findings.some((finding) => finding.code === 'premature_goal_completion'));
});

test('Phase-Eval relation SSOT requires exactly one unshared explicit Eval', async () => {
  const master = await fixture('valid-master');
  const missing = graphAuthority(await fixture('valid-loop'));
  missing.nodes.find((node) => node.type === 'Eval').status = 'passed';
  delete missing.nodes.find((node) => node.type === 'Phase').relatedNodeIds;
  const missingNext = queryNext(missing);
  assert.equal(missingNext.action, 'define_phase_eval_relation');
  assert.ok(missingNext.blockers.some((blocker) => blocker.code === 'phase_eval_relation_missing'));
  assert.throws(() => createPhaseHandoff(missing, master, {
    handoffId: 'handoff.eval-missing', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  }), (error) => error.exitCode === 3);

  const ambiguous = loopReadyForHandoff(await fixture('valid-loop'));
  ambiguous.nodes.push({
    id: 'eval.second', type: 'Eval', status: 'passed', ref: 'Docs/checkout/loop/eval-2',
    hash: '9999999999999999999999999999999999999999999999999999999999999999',
  });
  ambiguous.nodes.find((node) => node.type === 'Phase').relatedNodeIds.push('eval.second');
  assert.equal(queryNext(ambiguous).action, 'resolve_phase_eval_relation');
  assert.ok(queryNext(ambiguous).blockers.some((blocker) => blocker.code === 'phase_eval_relation_ambiguous'));

  const shared = loopReadyForHandoff(await fixture('valid-loop'));
  shared.nodes.push({
    id: 'phase.second', type: 'Phase', status: 'complete', ref: 'Docs/checkout/loop/phase-2',
    hash: '8888888888888888888888888888888888888888888888888888888888888888',
    relatedNodeIds: ['eval.checkout'],
  });
  assert.equal(queryNext(shared).action, 'resolve_phase_eval_relation');
  assert.ok(queryNext(shared).blockers.some((blocker) => blocker.code === 'phase_eval_relation_shared'));
  const phase = shared.nodes.find((node) => node.id === 'phase.checkout');
  phase.status = 'active';
  permit(shared, 'phase.owner', phase.id);
  assert.throws(
    () => planTransition(shared, { nodeId: phase.id, toStatus: 'complete', actorId: 'phase.owner' }),
    (error) => error.findings.some((finding) => finding.code === 'phase_eval_relation_shared'),
  );

  const reverse = graphAuthority(await fixture('valid-loop'));
  reverse.nodes.find((node) => node.type === 'Eval').status = 'passed';
  reverse.nodes.find((node) => node.type === 'Eval').relatedNodeIds = ['phase.checkout'];
  const eligible = queryNext(reverse);
  assert.equal(eligible.action, 'handoff_phase');
  assert.deepEqual(eligible.controls.evalId, 'eval.checkout');
});

test('Requirement scope uses all stable Requirement IDs across handoff and acceptance', async () => {
  const noRequirement = await fixture('valid-master');
  noRequirement.nodes = noRequirement.nodes.filter((node) => node.type !== 'Requirement');
  noRequirement.edges = noRequirement.edges.filter((edge) => !['implements', 'verifies'].includes(edge.type));
  const define = queryNext(noRequirement);
  assert.equal(define.action, 'define_requirement');
  assert.ok(define.blockers.some((blocker) => blocker.code === 'requirement_scope_missing'));

  const loop = loopReadyForHandoff(await fixture('valid-loop'));
  const master = addSecondRequirement(masterReady(await fixture('valid-master')));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.multi-requirement', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.deepEqual(handoff.requirementRefs, ['req.checkout', 'req.second']);
  assert.equal(validateContract(handoff, SCHEMA_IDS.phaseHandoff).valid, true);
  const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
  const acceptance = createAcceptanceResult(admittedMaster, loop, handoff, {
    resultId: 'result.multi-requirement', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.deepEqual(acceptance.requirementIds, ['req.checkout', 'req.second']);
  assert.equal(validateContract(acceptance, SCHEMA_IDS.phaseResult).valid, true);

  const reordered = structuredClone(master);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  const reorderedHandoff = createPhaseHandoff(loop, reordered, {
    handoffId: 'handoff.multi-requirement-reordered', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.deepEqual(reorderedHandoff.requirementRefs, handoff.requirementRefs);
});

test('terminal contexts select the complete decision governance domain', async () => {
  const master = masterReady(await fixture('valid-master'));
  const masterIds = master.nodes.map((node) => node.id).sort();
  const masterNext = queryNext(master);
  assert.equal(masterNext.action, 'collect_acceptance');
  assert.deepEqual(masterNext.targetNodeIds, masterIds);
  const masterContext = buildMinimalContext(master);
  assert.deepEqual(masterContext.selectedNodeIds, masterIds);
  assert.deepEqual(masterContext.nodeSummaries.map((node) => node.id), masterIds);

  const loop = loopReadyForHandoff(await fixture('valid-loop'));
  loop.nodes.find((node) => node.type === 'Phase').status = 'complete';
  loop.nodes.find((node) => node.type === 'Goal').status = 'complete';
  const loopIds = loop.nodes.map((node) => node.id).sort();
  assert.deepEqual(queryNext(loop).targetNodeIds, loopIds);
  assert.deepEqual(buildMinimalContext(loop).nodeSummaries.map((node) => node.id), loopIds);

  master.nodes.reverse();
  master.edges.reverse();
  loop.nodes.reverse();
  loop.edges.reverse();
  assert.deepEqual(buildMinimalContext(master).selectedNodeIds, masterIds);
  assert.deepEqual(buildMinimalContext(loop).selectedNodeIds, loopIds);
});

test('Loop control coordinates select explicit usable nodes and reject ambiguity', async () => {
  const loop = loopReadyForHandoff(await fixture('valid-loop'));
  loop.nodes.push(
    {
      id: 'phase.history', type: 'Phase', status: 'complete', ref: 'Docs/checkout/loop/phase-history',
      hash: '7777777777777777777777777777777777777777777777777777777777777777',
      relatedNodeIds: [
        'goal.history', 'baseline.history', 'envelope.history', 'budget.history', 'eval.history',
      ],
    },
    {
      id: 'goal.history', type: 'Goal', status: 'complete', ref: 'Docs/checkout/requirements-history',
      hash: '8888888888888888888888888888888888888888888888888888888888888888',
    },
    {
      id: 'baseline.history', type: 'Baseline', status: 'passed', ref: 'Docs/checkout/loop/baseline-history',
      hash: '6666666666666666666666666666666666666666666666666666666666666666',
    },
    {
      id: 'envelope.history', type: 'Envelope', status: 'passed', ref: 'Docs/checkout/loop/envelope-history',
      hash: '9999999999999999999999999999999999999999999999999999999999999999',
    },
    {
      id: 'budget.history', type: 'Budget', status: 'active', ref: 'Docs/checkout/loop/budget-history',
      hash: '5555555555555555555555555555555555555555555555555555555555555555',
    },
    {
      id: 'eval.history', type: 'Eval', status: 'passed', ref: 'Docs/checkout/loop/eval-history',
      hash: '4444444444444444444444444444444444444444444444444444444444444444',
    },
  );
  const phase = loop.nodes.find((node) => node.id === 'phase.checkout');
  phase.relatedNodeIds.push('goal.checkout', 'envelope.checkout', 'budget.checkout');
  const next = queryNext(loop);
  assert.equal(next.action, 'handoff_phase');
  assert.deepEqual(next.controls, {
    goalId: 'goal.checkout',
    baselineId: 'baseline.checkout',
    envelopeId: 'envelope.checkout',
    budgetId: 'budget.checkout',
    evalId: 'eval.checkout',
  });

  const master = await fixture('valid-master');
  const reversed = structuredClone(loop);
  reversed.nodes.reverse();
  reversed.edges.reverse();
  assert.deepEqual(queryNext(reversed), next);
  const handoff = createPhaseHandoff(reversed, master, {
    handoffId: 'handoff.coordinates', phaseId: phase.id, issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.equal(handoff.baselineId, 'baseline.checkout');
  assert.equal(handoff.budgetSummary.id, 'budget.checkout');

  const ambiguous = loopReadyForHandoff(await fixture('valid-loop'));
  ambiguous.nodes.push({
    id: 'budget.second', type: 'Budget', status: 'active', ref: 'Docs/checkout/loop/budget-second',
    hash: '3333333333333333333333333333333333333333333333333333333333333333',
  });
  const blocked = queryNext(ambiguous);
  assert.equal(blocked.action, 'resolve_control_coordinates');
  assert.ok(blocked.blockers.some((blocker) => blocker.code === 'ambiguous_budget_control'));
});

test('normal Loop to multi-Requirement Master path reaches acceptance and stop', async () => {
  const loop = loopReadyForHandoff(await fixture('valid-loop'));
  const master = addSecondRequirement(masterReady(await fixture('valid-master')));
  const before = queryNext(loop);
  assert.equal(before.action, 'handoff_phase');
  assert.deepEqual(before.targetNodeIds, ['phase.checkout']);
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.normal-round3', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admission = acceptPhaseHandoff(handoff, loop, master);
  assert.equal(admission.accepted, true);
  const acceptance = createAcceptanceResult(admission.masterGraph, loop, handoff, {
    resultId: 'result.normal-round3', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.deepEqual(acceptance.requirementIds, ['req.checkout', 'req.second']);

  loop.nodes.find((node) => node.type === 'Phase').status = 'complete';
  loop.nodes.find((node) => node.type === 'Goal').status = 'complete';
  assert.equal(queryNext(loop).action, 'stop_complete');
});
