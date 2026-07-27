import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  acceptPhaseHandoff,
  buildMinimalContext,
  consumePhaseResult,
  createAcceptanceResult,
  createPhaseHandoff,
  graphHash,
  planTransition,
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

function bindPhase(phase, evalId) {
  phase.relatedNodeIds = [
    'goal.checkout', 'baseline.checkout', 'envelope.checkout', 'budget.checkout', evalId,
  ];
  return phase;
}

function readyLoop(loop) {
  graphAuthority(loop);
  bindPhase(loop.nodes.find((node) => node.id === 'phase.checkout'), 'eval.checkout').status = 'ready';
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

function addReadyRequirement(master) {
  master.nodes.push(
    {
      id: 'req.second', type: 'Requirement', status: 'complete',
      hash: '1111111111111111111111111111111111111111111111111111111111111111',
      sourceRevision: 'git:def456',
    },
    {
      id: 'task.second', type: 'Task', status: 'complete', owner: 'implementation',
      actorId: 'maker.second', reviewerActorId: 'reviewer.second', files: ['src/second.mjs'],
    },
    { id: 'test.second', type: 'Test', status: 'passed', ref: 'test/second.test.mjs#case' },
    {
      id: 'evidence.second', type: 'Evidence', status: 'passed', subjectId: 'req.second',
      subjectHash: '1111111111111111111111111111111111111111111111111111111111111111',
      sourceRevision: 'git:def456', summary: 'Second requirement is acceptance-ready.',
      capturedAt: '2026-07-24T09:00:00.000Z', expiresAt: '2099-07-24T09:00:00.000Z',
    },
  );
  master.edges.push(
    { id: 'edge.second-task', type: 'implements', from: 'req.second', to: 'task.second' },
    { id: 'edge.second-test', type: 'verifies', from: 'test.second', to: 'req.second' },
  );
  return master;
}

function addEarlierPhase(loop, status = 'complete', evalStatus = 'passed') {
  loop.nodes.push(
    {
      id: 'phase.earlier', type: 'Phase', status, owner: 'master', ref: 'Docs/checkout/loop/phase-earlier',
      hash: '2222222222222222222222222222222222222222222222222222222222222222',
      relatedNodeIds: [
        'goal.checkout', 'baseline.checkout', 'envelope.checkout', 'budget.checkout', 'eval.earlier',
      ],
    },
    {
      id: 'eval.earlier', type: 'Eval', status: evalStatus, ref: 'Docs/checkout/loop/eval-earlier',
      hash: '3333333333333333333333333333333333333333333333333333333333333333',
      relatedNodeIds: ['phase.earlier'],
    },
  );
  loop.edges.push({
    id: 'edge.checkout-after-earlier', type: 'depends_on', from: 'phase.checkout', to: 'phase.earlier',
  });
  return loop;
}

function permit(graph, actorId, resourceRef) {
  graph.permissions.push({
    id: `permission.${actorId}.${resourceRef}`, actorId, action: 'transition', resourceRef, effect: 'allow',
  });
}

function assertReissue(operation) {
  assert.throws(operation, (error) => error.exitCode === 3
    && error.code === 'loop_baseline_change'
    && error.route?.action === 'reissue_handoff');
}

test('Phase DAG selects active or dependency-eligible ready sources, never a blocked sink', async () => {
  const chain = readyLoop(await fixture('valid-loop'));
  const root = chain.nodes.find((node) => node.id === 'phase.checkout');
  root.id = 'phase.root';
  root.ref = 'Docs/checkout/loop/phase-root';
  bindPhase(root, 'eval.checkout');
  chain.nodes.find((node) => node.id === 'eval.checkout').relatedNodeIds = ['phase.root'];
  for (const edge of chain.edges) {
    if (edge.from === 'phase.checkout') edge.from = 'phase.root';
    if (edge.to === 'phase.checkout') edge.to = 'phase.root';
  }
  chain.nodes.push(
    {
      id: 'phase.sink', type: 'Phase', status: 'ready', owner: 'master',
      ref: 'Docs/checkout/loop/phase-sink',
      hash: '4444444444444444444444444444444444444444444444444444444444444444',
      relatedNodeIds: [
        'goal.checkout', 'baseline.checkout', 'envelope.checkout', 'budget.checkout', 'eval.sink',
      ],
    },
    {
      id: 'eval.sink', type: 'Eval', status: 'passed', ref: 'Docs/checkout/loop/eval-sink',
      hash: '5555555555555555555555555555555555555555555555555555555555555555',
      relatedNodeIds: ['phase.sink'],
    },
  );
  chain.edges.push({ id: 'edge.sink-root', type: 'depends_on', from: 'phase.sink', to: 'phase.root' });

  const first = queryNext(chain);
  assert.equal(first.action, 'handoff_phase');
  assert.deepEqual(first.targetNodeIds, ['phase.root']);
  assert.deepEqual(first.eligiblePhases, ['phase.root']);
  assert.deepEqual(first.blockedPhases, [{
    nodeId: 'phase.sink', reasons: ['dependency_not_satisfied:phase.root'],
  }]);

  root.status = 'complete';
  chain.nodes.push(
    {
      id: 'phase.branch', type: 'Phase', status: 'ready', owner: 'master',
      ref: 'Docs/checkout/loop/phase-branch',
      hash: '6666666666666666666666666666666666666666666666666666666666666666',
      relatedNodeIds: [
        'goal.checkout', 'baseline.checkout', 'envelope.checkout', 'budget.checkout', 'eval.branch',
      ],
    },
    {
      id: 'eval.branch', type: 'Eval', status: 'passed', ref: 'Docs/checkout/loop/eval-branch',
      hash: '7777777777777777777777777777777777777777777777777777777777777777',
      relatedNodeIds: ['phase.branch'],
    },
  );
  chain.edges.push({ id: 'edge.branch-root', type: 'depends_on', from: 'phase.branch', to: 'phase.root' });
  const branch = queryNext(chain);
  assert.deepEqual(branch.eligiblePhases, ['phase.branch', 'phase.sink']);
  assert.deepEqual(branch.targetNodeIds, ['phase.branch']);
  const reordered = structuredClone(chain);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(queryNext(reordered), branch);

  chain.nodes.find((node) => node.id === 'phase.sink').status = 'active';
  const active = queryNext(chain);
  assert.equal(active.action, 'continue_phase');
  assert.deepEqual(active.targetNodeIds, ['phase.sink']);
});

test('Goal domain completion governs every related Phase, Eval, control, transition, and context target', async () => {
  const loop = addEarlierPhase(readyLoop(await fixture('valid-loop')), 'complete', 'failed');
  loop.nodes.find((node) => node.id === 'phase.checkout').status = 'complete';
  const domainIds = loop.nodes.map((node) => node.id).sort();

  const failed = queryNext(loop);
  assert.equal(failed.action, 'repair_phase_eval');
  assert.ok(failed.blockers.some((item) => item.nodeId === 'eval.earlier'));
  assert.deepEqual(failed.targetNodeIds, domainIds);
  assert.deepEqual(buildMinimalContext(loop).selectedNodeIds, domainIds);
  assert.deepEqual(buildMinimalContext(loop).nodeSummaries.map((node) => node.id), domainIds);

  permit(loop, 'goal.owner', 'goal.checkout');
  assert.throws(
    () => planTransition(loop, { nodeId: 'goal.checkout', toStatus: 'complete', actorId: 'goal.owner' }),
    (error) => error.findings.some((item) => item.code === 'phase_eval_required'),
  );

  loop.nodes.find((node) => node.id === 'eval.earlier').status = 'passed';
  const completeGoal = queryNext(loop);
  assert.equal(completeGoal.action, 'complete_goal');
  assert.deepEqual(completeGoal.targetNodeIds, domainIds);

  loop.nodes.find((node) => node.id === 'goal.checkout').status = 'complete';
  const terminal = queryNext(loop);
  assert.equal(terminal.action, 'stop_complete');
  assert.deepEqual(terminal.targetNodeIds, domainIds);

  const stopped = addEarlierPhase(readyLoop(await fixture('valid-loop')), 'stopped', 'passed');
  stopped.nodes.find((node) => node.id === 'phase.checkout').status = 'complete';
  const review = queryNext(stopped);
  assert.equal(review.action, 'stop_for_review');
  assert.ok(review.blockers.some((item) => item.code === 'phase_stopped'));
  assert.deepEqual(review.targetNodeIds, stopped.nodes.map((node) => node.id).sort());
});

test('handoff freezes canonical Requirement summaries and detects same-ID semantic drift', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const master = addReadyRequirement(readyMaster(await fixture('valid-master')));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.requirement-summary', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.deepEqual(handoff.requirementSummaries, [
    {
      id: 'req.checkout', ref: 'openspec/changes/checkout/specs/checkout/spec.md#checkout',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sourceRevision: 'git:abc123',
    },
    {
      id: 'req.second', ref: 'req.second',
      hash: '1111111111111111111111111111111111111111111111111111111111111111', sourceRevision: 'git:def456',
    },
  ]);

  for (const field of ['hash', 'sourceRevision']) {
    const incomplete = structuredClone(master);
    delete incomplete.nodes.find((node) => node.id === 'req.second')[field];
    assert.throws(
      () => createPhaseHandoff(loop, incomplete, {
        handoffId: `handoff.missing-${field}`, phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
      }),
      (error) => error.exitCode === 3 && error.code === 'handoff_requirement_incomplete',
    );
  }

  for (const field of ['ref', 'hash', 'sourceRevision']) {
    const drifted = structuredClone(master);
    const requirement = drifted.nodes.find((node) => node.id === 'req.checkout');
    requirement[field] = field === 'hash'
      ? '9999999999999999999999999999999999999999999999999999999999999999'
      : `${requirement[field]}-changed`;
    if (field === 'hash') drifted.nodes.find((node) => node.id === 'evidence.checkout').subjectHash = requirement.hash;
    if (field === 'sourceRevision') drifted.nodes.find((node) => node.id === 'evidence.checkout').sourceRevision = requirement.sourceRevision;
    assertReissue(() => createAcceptanceResult(drifted, loop, handoff, {
      resultId: `result.drift-${field}`, outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }));
  }
});

test('all handoff consumers share projection validation with set semantics and canonical evaluation hashes', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const master = addReadyRequirement(readyMaster(await fixture('valid-master')));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.projection-round5', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
  const acceptance = createAcceptanceResult(admittedMaster, loop, handoff, {
    resultId: 'result.projection-round5', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });

  const forged = structuredClone(handoff);
  forged.artifactRefs.push('Docs/forged-artifact.md');
  for (const operation of [
    () => acceptPhaseHandoff(forged, loop, master),
    () => createAcceptanceResult(admittedMaster, loop, forged, {
      resultId: 'result.forged', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    () => consumePhaseResult(loop, admittedMaster, forged, acceptance),
  ]) assert.throws(operation, (error) => error.exitCode === 3);

  const reorderedHandoff = structuredClone(handoff);
  reorderedHandoff.requirementRefs.reverse();
  reorderedHandoff.requirementSummaries.reverse();
  reorderedHandoff.artifactRefs.reverse();
  assert.equal(acceptPhaseHandoff(reorderedHandoff, loop, admittedMaster).accepted, true);
  const reorderedAcceptance = createAcceptanceResult(admittedMaster, loop, reorderedHandoff, {
    resultId: 'result.reordered', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  reorderedAcceptance.requirementIds.reverse();
  reorderedAcceptance.evidenceSummaries.reverse();
  assert.equal(consumePhaseResult(loop, admittedMaster, reorderedHandoff, reorderedAcceptance).action, 'next_phase');
});

test('Graph hash canonicalizes semantic sets while preserving semantic changes', async () => {
  const graph = await fixture('valid-loop');
  graph.acyclicEdgeTypes.push('requires');
  graph.authority.markdownSources.push({
    ref: 'Docs/checkout/loop/second.md',
    hash: '8888888888888888888888888888888888888888888888888888888888888888',
  });
  const phase = graph.nodes.find((node) => node.type === 'Phase');
  phase.relatedNodeIds = ['eval.checkout', 'goal.checkout', 'budget.checkout'];
  phase.prerequisiteIds = ['baseline.checkout', 'envelope.checkout'];
  phase.permissionIds = ['permission.loop-evaluate', 'permission.second'];
  graph.permissions.push({
    id: 'permission.second', actorId: 'loop-controller', action: 'evaluate',
    resourceRef: 'eval.checkout', effect: 'allow',
  });
  graph.eventRefs.push(
    { id: 'event.one', ref: '.dev-flow/runtime/run/events/event.one.json', hash: '1111111111111111111111111111111111111111111111111111111111111111' },
    { id: 'event.two', ref: '.dev-flow/runtime/run/events/event.two.json', hash: '2222222222222222222222222222222222222222222222222222222222222222' },
  );

  const reordered = structuredClone(graph);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  reordered.permissions.reverse();
  reordered.eventRefs.reverse();
  reordered.acyclicEdgeTypes.reverse();
  reordered.authority.markdownSources.reverse();
  for (const node of reordered.nodes) {
    for (const field of ['relatedNodeIds', 'prerequisiteIds', 'evidenceIds', 'permissionIds', 'eventRefIds', 'files', 'symbols']) {
      node[field]?.reverse();
    }
  }
  assert.equal(graphHash(reordered), graphHash(graph));
  assert.equal(buildMinimalContext(reordered).graphHash, buildMinimalContext(graph).graphHash);

  const statusChanged = structuredClone(reordered);
  statusChanged.nodes.find((node) => node.id === 'goal.checkout').status = 'stale';
  assert.notEqual(graphHash(statusChanged), graphHash(graph));
  const relationChanged = structuredClone(reordered);
  relationChanged.nodes.find((node) => node.id === 'phase.checkout').relatedNodeIds.pop();
  assert.notEqual(graphHash(relationChanged), graphHash(graph));
});
