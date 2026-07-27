import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SCHEMA_IDS,
  acceptPhaseHandoff,
  buildMinimalContext,
  checkGraph,
  checkShadowDrift,
  consumePhaseResult,
  createAcceptanceResult,
  createPhaseHandoff,
  planTransition,
  queryNext,
  readMarkdownProjection,
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

function multiGoalLoop(loop) {
  graphAuthority(loop);
  loop.nodes = [
    {
      id: 'goal.current', type: 'Goal', status: 'active', ref: 'Docs/current/goal',
      hash: '1111111111111111111111111111111111111111111111111111111111111111',
      relatedNodeIds: ['phase.current'],
    },
    {
      id: 'baseline.current', type: 'Baseline', status: 'passed', ref: 'Docs/current/baseline',
      hash: '2222222222222222222222222222222222222222222222222222222222222222',
      relatedNodeIds: ['phase.current'],
    },
    {
      id: 'envelope.current', type: 'Envelope', status: 'passed', ref: 'Docs/current/envelope',
      hash: '3333333333333333333333333333333333333333333333333333333333333333',
      relatedNodeIds: ['phase.current'],
    },
    {
      id: 'budget.current', type: 'Budget', status: 'active', ref: 'Docs/current/budget',
      hash: '4444444444444444444444444444444444444444444444444444444444444444',
      relatedNodeIds: ['phase.current'],
    },
    {
      id: 'eval.current', type: 'Eval', status: 'passed', ref: 'Docs/current/eval',
      hash: '5555555555555555555555555555555555555555555555555555555555555555',
      relatedNodeIds: ['phase.current'],
    },
    {
      id: 'phase.current', type: 'Phase', status: 'ready', owner: 'master', ref: 'Docs/current/phase',
      hash: '6666666666666666666666666666666666666666666666666666666666666666',
      relatedNodeIds: [
        'goal.current', 'baseline.current', 'envelope.current', 'budget.current', 'eval.current',
      ],
    },
    {
      id: 'goal.history', type: 'Goal', status: 'complete', ref: 'Docs/history/goal',
      hash: '7777777777777777777777777777777777777777777777777777777777777777',
      relatedNodeIds: ['phase.aaa-history'],
    },
    {
      id: 'baseline.history', type: 'Baseline', status: 'passed', ref: 'Docs/history/baseline',
      hash: '8888888888888888888888888888888888888888888888888888888888888888',
      relatedNodeIds: ['phase.aaa-history'],
    },
    {
      id: 'envelope.history', type: 'Envelope', status: 'passed', ref: 'Docs/history/envelope',
      hash: '9999999999999999999999999999999999999999999999999999999999999999',
      relatedNodeIds: ['phase.aaa-history'],
    },
    {
      id: 'budget.history', type: 'Budget', status: 'exhausted', ref: 'Docs/history/budget',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      relatedNodeIds: ['phase.aaa-history'],
    },
    {
      id: 'eval.history', type: 'Eval', status: 'passed', ref: 'Docs/history/eval',
      hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      relatedNodeIds: ['phase.aaa-history'],
    },
    {
      id: 'phase.aaa-history', type: 'Phase', status: 'active', owner: 'history', ref: 'Docs/history/phase',
      hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      relatedNodeIds: [
        'goal.history', 'baseline.history', 'envelope.history', 'budget.history', 'eval.history',
      ],
    },
  ];
  loop.edges = [];
  loop.permissions = [];
  loop.eventRefs = [];
  return loop;
}

function handoffMutationCases(handoff) {
  return [
    ['projectionHash', (value) => { value.projectionHash = 'f'.repeat(64); }],
    ['toGraph.hash', (value) => { value.toGraph.hash = 'e'.repeat(64); }],
    ['fromGraph.hash', (value) => { value.fromGraph.hash = 'd'.repeat(64); }],
    ['phaseHash', (value) => { value.phaseHash = 'c'.repeat(64); }],
    ['baselineHash', (value) => { value.baselineHash = 'b'.repeat(64); }],
    ['goalId', (value) => { value.goalId = 'goal.forged'; }],
    ['evalId', (value) => { value.evalId = 'eval.forged'; }],
    ['envelopeRef', (value) => { value.envelopeRef = 'Docs/forged/envelope'; }],
    ['budgetRef', (value) => { value.budgetRef = 'Docs/forged/budget'; }],
    ['requirementSummary', (value) => { value.requirementSummaries[0].hash = '9'.repeat(64); }],
    ['artifactRefs', (value) => { value.artifactRefs.push('Docs/forged/member'); }],
    ['issuedAt', (value) => { value.issuedAt = '2026-07-24T10:00:01.000Z'; }],
  ].map(([label, mutate]) => {
    const value = structuredClone(handoff);
    mutate(value);
    return [label, value];
  });
}

test('resolveCurrentGoal selects the operational Goal domain before any historical Phase', async () => {
  const active = multiGoalLoop(await fixture('valid-loop'));
  const next = queryNext(active);
  assert.equal(next.action, 'handoff_phase');
  assert.deepEqual(next.targetNodeIds, ['phase.current']);
  assert.equal(next.controls.goalId, 'goal.current');
  assert.ok(!next.targetNodeIds.includes('budget.history'));

  const stale = structuredClone(active);
  stale.nodes.find((node) => node.id === 'goal.current').status = 'stale';
  const repair = queryNext(stale);
  assert.equal(repair.action, 'repair_goal');
  assert.ok(repair.targetNodeIds.includes('goal.current'));
  assert.ok(!repair.targetNodeIds.includes('budget.history'));

  const pending = structuredClone(active);
  pending.nodes.find((node) => node.id === 'goal.current').status = 'pending';
  const establish = queryNext(pending);
  assert.equal(establish.action, 'repair_goal');
  assert.ok(establish.targetNodeIds.includes('goal.current'));
  assert.ok(!establish.targetNodeIds.includes('budget.history'));

  const ambiguous = structuredClone(active);
  ambiguous.nodes.find((node) => node.id === 'goal.history').status = 'active';
  ambiguous.nodes.find((node) => node.id === 'phase.aaa-history').status = 'ready';
  const blocked = queryNext(ambiguous);
  assert.equal(blocked.action, 'resolve_current_goal');
  assert.ok(blocked.blockers.some((item) => item.code === 'ambiguous_current_goal'));
  assert.deepEqual(blocked.targetNodeIds, ['goal.current', 'goal.history']);

  active.nodes.reverse();
  assert.deepEqual(queryNext(active), next);
});

test('current Goal resolution is shared by validation, context, and terminal transitions', async () => {
  const ambiguous = multiGoalLoop(await fixture('valid-loop'));
  ambiguous.nodes.find((node) => node.id === 'goal.history').status = 'active';
  ambiguous.nodes.find((node) => node.id === 'phase.aaa-history').status = 'ready';
  ambiguous.permissions = [
    { id: 'permission.current', actorId: 'goal.owner', action: 'transition', resourceRef: 'goal.current', effect: 'allow' },
    { id: 'permission.history', actorId: 'goal.owner', action: 'transition', resourceRef: 'goal.history', effect: 'allow' },
  ];

  assert.ok((await checkGraph(ambiguous)).findings
    .some((item) => item.code === 'ambiguous_current_goal'));
  const context = buildMinimalContext(ambiguous);
  assert.equal(context.action, 'resolve_current_goal');
  assert.deepEqual(context.selectedNodeIds, ['goal.current', 'goal.history']);
  assert.throws(
    () => planTransition(ambiguous, {
      nodeId: 'goal.current', toStatus: 'stopped', actorId: 'goal.owner',
    }),
    (error) => error.findings.some((item) => item.code === 'ambiguous_current_goal'),
  );

  const selected = structuredClone(ambiguous);
  selected.nodes.find((node) => node.id === 'phase.current').status = 'active';
  assert.equal(queryNext(selected).action, 'continue_phase');
  assert.throws(
    () => planTransition(selected, {
      nodeId: 'goal.history', toStatus: 'stopped', actorId: 'goal.owner',
    }),
    (error) => error.findings.some((item) => item.code === 'goal_not_current'),
  );

  const currentOnly = multiGoalLoop(await fixture('valid-loop'));
  currentOnly.permissions = [
    { id: 'permission.current', actorId: 'goal.owner', action: 'transition', resourceRef: 'goal.current', effect: 'allow' },
  ];
  assert.equal(planTransition(currentOnly, {
    nodeId: 'goal.current', toStatus: 'stopped', actorId: 'goal.owner',
  }).toStatus, 'stopped');
});

test('handoff and phase result content digests bind every issued field across all consumers', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const initialMaster = await fixture('valid-master');
  const handoff = createPhaseHandoff(loop, initialMaster, {
    handoffId: 'handoff.digest-round6', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  assert.match(handoff.projectionHash, /^[a-f0-9]{64}$/);
  assert.equal(validateContract(handoff, SCHEMA_IDS.phaseHandoff).valid, true);
  const admission = acceptPhaseHandoff(handoff, loop, initialMaster);
  assert.equal(admission.accepted, true);

  const evolvedMaster = readyMaster(structuredClone(admission.masterGraph));
  const acceptance = createAcceptanceResult(evolvedMaster, loop, handoff, {
    resultId: 'result.digest-round6', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.equal(acceptance.handoffHash, handoff.projectionHash);
  assert.equal(validateContract(acceptance, SCHEMA_IDS.phaseResult).valid, true);
  assert.equal(consumePhaseResult(loop, evolvedMaster, handoff, acceptance).action, 'next_phase');

  for (const [label, forged] of handoffMutationCases(handoff)) {
    for (const operation of [
      () => acceptPhaseHandoff(forged, loop, initialMaster),
      () => createAcceptanceResult(evolvedMaster, loop, forged, {
        resultId: `result.${label.replaceAll('.', '-')}`, outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
      }),
      () => consumePhaseResult(loop, evolvedMaster, forged, acceptance),
    ]) assert.throws(operation, (error) => error.exitCode === 3
      && error.code === 'handoff_projection_hash_mismatch', label);
  }

  const rebound = structuredClone(acceptance);
  rebound.handoffHash = '0'.repeat(64);
  assert.throws(
    () => consumePhaseResult(loop, evolvedMaster, handoff, rebound),
    (error) => error.exitCode === 3 && error.code === 'phase_result_handoff_hash_mismatch',
  );

  const reordered = structuredClone(handoff);
  reordered.requirementRefs.reverse();
  reordered.requirementSummaries.reverse();
  reordered.artifactRefs.reverse();
  assert.equal(acceptPhaseHandoff(reordered, loop, evolvedMaster).accepted, true);
  assert.equal(createAcceptanceResult(evolvedMaster, loop, reordered, {
    resultId: 'result.digest-reordered', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  }).handoffHash, handoff.projectionHash);
});

test('Shadow drift hashes canonical fenced semantics across nested and multi-source reordering', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-round6-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const firstPath = path.join(directory, 'first.md');
  const secondPath = path.join(directory, 'second.md');
  const firstRef = path.basename(firstPath);
  const secondRef = path.basename(secondPath);
  const firstProjection = {
    nodes: [
      { id: 'req.one', type: 'Requirement', status: 'ready', relatedNodeIds: ['task.two', 'task.one'] },
      { id: 'task.one', type: 'Task', status: 'planned', prerequisiteIds: ['req.one'], files: ['b.mjs', 'a.mjs'] },
    ],
    edges: [{ id: 'edge.one', type: 'implements', from: 'req.one', to: 'task.one' }],
    permissions: [{ id: 'permission.one', actorId: 'maker.one', action: 'transition', resourceRef: 'task.one', effect: 'allow' }],
  };
  const secondProjection = {
    nodes: [{ id: 'task.two', type: 'Task', status: 'planned', symbols: ['zeta', 'alpha'] }],
    edges: [],
    permissions: [],
  };
  const markdown = (title, projection) => `# ${title}\n\n\`\`\`dev-flow-graph\n${JSON.stringify(projection)}\n\`\`\`\n`;
  await writeFile(firstPath, markdown('First', firstProjection));
  await writeFile(secondPath, markdown('Second', secondProjection));
  const snapshot = await readMarkdownProjection([secondRef, firstRef], { sourceRoot: directory });

  const graph = {
    $schema: 'https://dev-flow.dev/schemas/v1/master-graph.schema.json',
    schemaVersion: '1.0.0', graphKind: 'master', id: 'master.shadow-round6', topicRef: 'Docs/shadow-round6',
    authority: {
      mode: 'shadow', sourceOfTruth: 'markdown', syncDirection: 'markdown_to_graph',
      graphMutationAllowed: false, markdownViewReadableAsAuthority: true,
      markdownSources: snapshot.markdownSources,
    },
    revision: 0, acyclicEdgeTypes: ['depends_on', 'control'],
    ...snapshot.projection, eventRefs: [],
  };

  const reorderedFirst = structuredClone(firstProjection);
  reorderedFirst.nodes.reverse();
  reorderedFirst.nodes.forEach((node) => {
    node.relatedNodeIds?.reverse();
    node.prerequisiteIds?.reverse();
    node.files?.reverse();
  });
  await writeFile(firstPath, `Changed prose only.\n\n${markdown('First reordered', reorderedFirst)}`);
  await writeFile(secondPath, markdown('Second reordered', {
    ...secondProjection,
    nodes: secondProjection.nodes.map((node) => ({ ...node, symbols: [...node.symbols].reverse() })),
  }));
  const reorderedSnapshot = await readMarkdownProjection([firstRef, secondRef], { sourceRoot: directory });
  assert.deepEqual(reorderedSnapshot.markdownSources, snapshot.markdownSources);
  assert.deepEqual(reorderedSnapshot.projection, snapshot.projection);
  assert.deepEqual(await checkShadowDrift(graph, { sourceRoot: directory }), []);

  const semanticChange = structuredClone(reorderedFirst);
  semanticChange.nodes.find((node) => node.id === 'req.one').status = 'stale';
  await writeFile(firstPath, markdown('First changed', semanticChange));
  assert.ok((await checkShadowDrift(graph, { sourceRoot: directory }))
    .some((item) => item.code === 'shadow_drift'));
});
