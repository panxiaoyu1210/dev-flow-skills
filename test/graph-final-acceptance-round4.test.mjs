import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  acceptPhaseHandoff,
  consumePhaseResult,
  createAcceptanceResult,
  createPhaseEvaluationResult,
  createPhaseHandoff,
  queryNext,
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

function boundLoop(loop) {
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

function addReadyRequirement(master, suffix = 'second') {
  master.nodes.push(
    {
      id: `req.${suffix}`, type: 'Requirement', status: 'complete',
      hash: '1111111111111111111111111111111111111111111111111111111111111111',
      sourceRevision: 'git:abc123',
    },
    {
      id: `task.${suffix}`, type: 'Task', status: 'complete', owner: 'implementation',
      actorId: `maker.${suffix}`, reviewerActorId: `reviewer.${suffix}`, files: [`src/${suffix}.mjs`],
    },
    {
      id: `test.${suffix}`, type: 'Test', status: 'passed', ref: `test/${suffix}.test.mjs#case`,
    },
  );
  master.edges.push(
    { id: `edge.${suffix}-task`, type: 'implements', from: `req.${suffix}`, to: `task.${suffix}` },
    { id: `edge.${suffix}-test`, type: 'verifies', from: `test.${suffix}`, to: `req.${suffix}` },
  );
  return master;
}

function assertReissue(operation) {
  assert.throws(operation, (error) => error.exitCode === 3
    && error.code === 'loop_baseline_change'
    && error.route?.classification === 'loop_baseline_change'
    && error.route?.action === 'reissue_handoff');
}

function addHistoricalDomain(loop, { first = false } = {}) {
  const nodes = [
    {
      id: 'goal.history', type: 'Goal', status: 'complete', ref: 'Docs/history/requirements.md#goal',
      hash: '1010101010101010101010101010101010101010101010101010101010101010',
      relatedNodeIds: ['phase.history'],
    },
    {
      id: 'baseline.history', type: 'Baseline', status: 'passed', ref: 'Docs/history/loop/baseline',
      hash: '2020202020202020202020202020202020202020202020202020202020202020',
      relatedNodeIds: ['phase.history'],
    },
    {
      id: 'envelope.history', type: 'Envelope', status: 'passed', ref: 'Docs/history/loop/envelope',
      hash: '3030303030303030303030303030303030303030303030303030303030303030',
      relatedNodeIds: ['phase.history'],
    },
    {
      id: 'budget.history', type: 'Budget', status: 'exhausted', ref: 'Docs/history/loop/budget',
      hash: '4040404040404040404040404040404040404040404040404040404040404040',
      relatedNodeIds: ['phase.history'],
    },
    {
      id: 'eval.history', type: 'Eval', status: 'passed', ref: 'Docs/history/loop/eval',
      hash: '5050505050505050505050505050505050505050505050505050505050505050',
      relatedNodeIds: ['phase.history'],
    },
    {
      id: 'phase.history', type: 'Phase', status: 'complete', ref: 'Docs/history/loop/phase',
      hash: '6060606060606060606060606060606060606060606060606060606060606060',
      relatedNodeIds: [
        'goal.history', 'baseline.history', 'envelope.history', 'budget.history', 'eval.history',
      ],
    },
  ];
  if (first) loop.nodes.unshift(...nodes);
  else loop.nodes.push(...nodes);
  loop.edges.push({
    id: 'edge.current-after-history', type: 'depends_on', from: 'phase.checkout', to: 'phase.history',
  });
  return loop;
}

test('selected Loop coordinates enforce Budget > Goal > other controls > Eval priority matrix', async () => {
  const combinations = [
    { budget: 'exhausted', goal: 'active', evaluation: 'pending', action: 'stop_budget_exhausted' },
    { budget: 'exhausted', goal: 'stale', evaluation: 'failed', action: 'stop_budget_exhausted' },
    { budget: 'active', goal: 'stale', evaluation: 'pending', action: 'repair_goal' },
    { budget: 'active', goal: 'active', evaluation: 'pending', action: 'evaluate_phase' },
  ];
  for (const combination of combinations) {
    const loop = boundLoop(await fixture('valid-loop'));
    loop.nodes.find((node) => node.id === 'budget.checkout').status = combination.budget;
    loop.nodes.find((node) => node.id === 'goal.checkout').status = combination.goal;
    loop.nodes.find((node) => node.id === 'eval.checkout').status = combination.evaluation;
    const next = queryNext(loop);
    assert.equal(next.action, combination.action, JSON.stringify(combination));
    if (combination.action === 'stop_budget_exhausted') {
      assert.deepEqual(next.targetNodeIds, ['budget.checkout']);
      assert.ok(next.blockers.some((item) => item.code === 'budget_exhausted'));
    }
    if (combination.action === 'evaluate_phase') {
      assert.deepEqual(next.targetNodeIds, ['eval.checkout']);
      assert.ok(next.eligibleEvals.includes('eval.checkout'));
    }
  }

  const historyDoesNotStopCurrent = boundLoop(await fixture('valid-loop'));
  historyDoesNotStopCurrent.nodes.unshift({
    id: 'budget.history', type: 'Budget', status: 'exhausted', ref: 'Docs/history/budget',
    hash: '7070707070707070707070707070707070707070707070707070707070707070',
  });
  assert.equal(queryNext(historyDoesNotStopCurrent).action, 'handoff_phase');
});

test('Requirement scope is an exact order-insensitive handoff binding across acceptance and consumption', async () => {
  const loop = boundLoop(await fixture('valid-loop'));
  const master = readyMaster(await fixture('valid-master'));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.scope-round4', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;

  const reordered = structuredClone(admittedMaster);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(createAcceptanceResult(reordered, loop, handoff, {
    resultId: 'result.scope-reordered', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  }).requirementIds, handoff.requirementRefs);

  const added = addReadyRequirement(structuredClone(admittedMaster));
  assertReissue(() => createAcceptanceResult(added, loop, handoff, {
    resultId: 'result.scope-added', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  }));

  const removed = structuredClone(admittedMaster);
  removed.nodes = removed.nodes.filter((node) => node.type !== 'Requirement');
  removed.edges = removed.edges.filter((edge) => !['implements', 'verifies'].includes(edge.type));
  assertReissue(() => createAcceptanceResult(removed, loop, handoff, {
    resultId: 'result.scope-removed', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  }));

  const replaced = structuredClone(admittedMaster);
  replaced.nodes.find((node) => node.id === 'req.checkout').id = 'req.replaced';
  replaced.nodes.find((node) => node.id === 'evidence.checkout').subjectId = 'req.replaced';
  for (const edge of replaced.edges) {
    if (edge.from === 'req.checkout') edge.from = 'req.replaced';
    if (edge.to === 'req.checkout') edge.to = 'req.replaced';
  }
  assertReissue(() => createAcceptanceResult(replaced, loop, handoff, {
    resultId: 'result.scope-replaced', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  }));

  const acceptance = createAcceptanceResult(admittedMaster, loop, handoff, {
    resultId: 'result.scope-original', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  const reboundHandoff = { ...handoff, requirementRefs: ['req.rebound'] };
  assert.throws(
    () => consumePhaseResult(loop, admittedMaster, reboundHandoff, acceptance),
    (error) => error.exitCode === 3 && error.code === 'handoff_projection_hash_mismatch',
  );
});

test('all result consumers use handoff-bound controls and ignore historical control order', async () => {
  for (const historicalFirst of [false, true]) {
    const loop = addHistoricalDomain(boundLoop(await fixture('valid-loop')), { first: historicalFirst });
    const master = readyMaster(await fixture('valid-master'));
    const handoff = createPhaseHandoff(loop, master, {
      handoffId: `handoff.bound-${historicalFirst}`, phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
    });
    assert.equal(handoff.budgetSummary.id, 'budget.checkout');
    const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
    const acceptance = createAcceptanceResult(admittedMaster, loop, handoff, {
      resultId: `result.bound-${historicalFirst}`, outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    });
    assert.equal(consumePhaseResult(loop, admittedMaster, handoff, acceptance).action, 'next_phase');
    assert.equal(createPhaseEvaluationResult(loop, admittedMaster, handoff, acceptance, {
      resultId: `phase-eval.bound-${historicalFirst}`, issuedAt: '2026-07-24T11:01:00.000Z',
    }).outcome, 'passed');

    const drifted = structuredClone(loop);
    drifted.nodes = drifted.nodes.filter((node) => node.id !== handoff.budgetSummary.id);
    assertReissue(() => consumePhaseResult(drifted, admittedMaster, handoff, acceptance));
  }
});

test('historical complete Goals never capture the current Phase or terminal governance domain', async () => {
  const loop = addHistoricalDomain(boundLoop(await fixture('valid-loop')));
  const current = queryNext(loop);
  assert.equal(current.action, 'handoff_phase');
  assert.deepEqual(current.controls, {
    goalId: 'goal.checkout', baselineId: 'baseline.checkout', envelopeId: 'envelope.checkout',
    budgetId: 'budget.checkout', evalId: 'eval.checkout',
  });

  const reordered = structuredClone(loop);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(queryNext(reordered), current);

  const ambiguous = boundLoop(await fixture('valid-loop'));
  ambiguous.nodes.find((node) => node.id === 'phase.checkout').relatedNodeIds = ['eval.checkout'];
  ambiguous.nodes.push({
    id: 'goal.second', type: 'Goal', status: 'active', ref: 'Docs/second/goal',
    hash: '8080808080808080808080808080808080808080808080808080808080808080',
  });
  const blocked = queryNext(ambiguous);
  assert.equal(blocked.action, 'resolve_current_goal');
  assert.ok(blocked.blockers.some((item) => item.code === 'ambiguous_current_goal'));

  loop.nodes.find((node) => node.id === 'phase.checkout').status = 'complete';
  loop.nodes.find((node) => node.id === 'goal.checkout').status = 'complete';
  const terminal = queryNext(loop);
  assert.equal(terminal.action, 'stop_complete');
  assert.deepEqual(terminal.targetNodeIds, [
    'baseline.checkout', 'budget.checkout', 'envelope.checkout', 'eval.checkout',
    'goal.checkout', 'phase.checkout',
  ]);
});

test('normal bound Loop to multi-Requirement Master path remains complete', async () => {
  const loop = boundLoop(await fixture('valid-loop'));
  const master = addReadyRequirement(readyMaster(await fixture('valid-master')));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.normal-round4', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
  const acceptance = createAcceptanceResult(admittedMaster, loop, handoff, {
    resultId: 'result.normal-round4', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.deepEqual(acceptance.requirementIds, ['req.checkout', 'req.second']);
  assert.equal(consumePhaseResult(loop, admittedMaster, handoff, acceptance).action, 'next_phase');
});
