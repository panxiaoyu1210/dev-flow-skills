import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
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
  graphHash,
  handoffReceiptHash,
  phaseHandoffHash,
  phaseResultHash,
  queryNext,
  readMarkdownProjection,
  validateContract,
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

function addGoalDomain(loop, prefix, goalStatus, phaseStatus, budgetStatus) {
  const ids = {
    goal: `goal.${prefix}`, baseline: `baseline.${prefix}`, envelope: `envelope.${prefix}`,
    budget: `budget.${prefix}`, evaluation: `eval.${prefix}`, phase: `phase.${prefix}`,
  };
  loop.nodes.push(
    { id: ids.goal, type: 'Goal', status: goalStatus, ref: `Docs/${prefix}/goal`, hash: '1'.repeat(64), relatedNodeIds: [ids.phase] },
    { id: ids.baseline, type: 'Baseline', status: 'passed', ref: `Docs/${prefix}/baseline`, hash: '2'.repeat(64), relatedNodeIds: [ids.phase] },
    { id: ids.envelope, type: 'Envelope', status: 'passed', ref: `Docs/${prefix}/envelope`, hash: '3'.repeat(64), relatedNodeIds: [ids.phase] },
    { id: ids.budget, type: 'Budget', status: budgetStatus, ref: `Docs/${prefix}/budget`, hash: '4'.repeat(64), relatedNodeIds: [ids.phase] },
    { id: ids.evaluation, type: 'Eval', status: 'passed', ref: `Docs/${prefix}/eval`, hash: '5'.repeat(64), relatedNodeIds: [ids.phase] },
    {
      id: ids.phase, type: 'Phase', status: phaseStatus, owner: prefix, ref: `Docs/${prefix}/phase`, hash: '6'.repeat(64),
      relatedNodeIds: [ids.goal, ids.baseline, ids.envelope, ids.budget, ids.evaluation],
    },
  );
  return ids;
}

test('operational Goal priority isolates its Phase/control domain from historical ordering', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const history = addGoalDomain(loop, 'aaa-history', 'complete', 'active', 'exhausted');
  for (const status of ['active', 'stale', 'blocked', 'pending']) {
    loop.nodes.find((node) => node.id === 'goal.checkout').status = status;
    const next = queryNext(loop);
    assert.ok(!next.targetNodeIds.includes(history.budget), status);
    assert.ok(!buildMinimalContext(loop).selectedNodeIds.includes(history.budget), status);
    assert.ok(!(await checkGraph(loop)).findings.some((item) => item.nodeIds.includes(history.budget)
      && item.code === 'premature_goal_completion'), status);
  }

  loop.nodes.find((node) => node.id === 'goal.checkout').status = 'active';
  const second = addGoalDomain(loop, 'second', 'active', 'ready', 'active');
  loop.nodes.find((node) => node.id === 'phase.checkout').status = 'ready';
  const ambiguous = queryNext(loop);
  assert.equal(ambiguous.action, 'resolve_current_goal');
  assert.deepEqual(ambiguous.targetNodeIds, ['goal.checkout', second.goal]);
  loop.nodes.reverse();
  loop.edges.reverse();
  assert.deepEqual(queryNext(loop), ambiguous);
});

test('Master Graph receipt is the persisted handoff admission root', async (t) => {
  const loop = readyLoop(await fixture('valid-loop'));
  const initialMaster = await fixture('valid-master');
  assert.deepEqual(initialMaster.handoffReceipts, []);
  assert.equal(validateContract(initialMaster, SCHEMA_IDS.masterGraph).valid, true);
  const handoff = createPhaseHandoff(loop, initialMaster, {
    handoffId: 'handoff.receipt-round7', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });

  assert.throws(
    () => createAcceptanceResult(readyMaster(structuredClone(initialMaster)), loop, handoff, {
      resultId: 'result.unaccepted', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    (error) => error.exitCode === 3 && error.code === 'handoff_not_accepted',
  );

  const accepted = acceptPhaseHandoff(handoff, loop, initialMaster, {
    actorId: 'master.acceptance', acceptedAt: '2026-07-24T10:01:00.000Z',
  });
  assert.equal(accepted.accepted, true);
  assert.notEqual(accepted.masterGraph, initialMaster);
  assert.deepEqual(initialMaster.handoffReceipts, []);
  assert.equal(accepted.masterGraph.handoffReceipts.length, 1);
  assert.equal(accepted.receipt.projectionHash, handoff.projectionHash);
  assert.equal(validateContract(accepted.masterGraph, SCHEMA_IDS.masterGraph).valid, true);
  assert.equal((await checkGraph(accepted.masterGraph)).valid, true);
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-receipt-round7-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const graphPath = path.join(directory, 'dev-flow-graph.json');
  await writeGraphFile(graphPath, accepted.masterGraph);
  const persistedMaster = JSON.parse(await readFile(graphPath, 'utf8'));
  assert.deepEqual(persistedMaster.handoffReceipts, accepted.masterGraph.handoffReceipts);

  const secondReceiptBase = {
    ...accepted.receipt,
    handoffId: 'handoff.second-round7',
    projectionHash: 'a'.repeat(64),
    acceptedAt: '2026-07-24T10:02:00.000Z',
  };
  const { receiptHash: _receiptHash, ...secondReceiptPayload } = secondReceiptBase;
  const withSecondReceipt = structuredClone(accepted.masterGraph);
  withSecondReceipt.handoffReceipts.push({
    ...secondReceiptPayload,
    receiptHash: handoffReceiptHash(secondReceiptPayload),
  });
  const canonicalReceiptHash = graphHash(withSecondReceipt);
  withSecondReceipt.handoffReceipts.reverse();
  assert.equal(graphHash(withSecondReceipt), canonicalReceiptHash);

  const acceptedSourceRef = 'accepted.md';
  await writeFile(path.join(directory, acceptedSourceRef), markdown(graphProjection(accepted.masterGraph)));
  const acceptedSnapshot = await readMarkdownProjection([acceptedSourceRef], { sourceRoot: directory });
  const shadowAccepted = structuredClone(accepted.masterGraph);
  shadowAccepted.authority = {
    mode: 'shadow', sourceOfTruth: 'markdown', syncDirection: 'markdown_to_graph',
    graphMutationAllowed: false, markdownViewReadableAsAuthority: true,
    markdownSources: acceptedSnapshot.markdownSources,
  };
  assert.equal((await acceptPhaseHandoff(handoff, loop, shadowAccepted, {
    sourceRoot: directory,
  })).alreadyAccepted, true);

  const missingSourceRef = 'missing.md';
  await writeFile(path.join(directory, missingSourceRef), markdown(graphProjection(initialMaster)));
  const missingSnapshot = await readMarkdownProjection([missingSourceRef], { sourceRoot: directory });
  const shadowMissing = structuredClone(initialMaster);
  shadowMissing.authority = {
    mode: 'shadow', sourceOfTruth: 'markdown', syncDirection: 'markdown_to_graph',
    graphMutationAllowed: false, markdownViewReadableAsAuthority: true,
    markdownSources: missingSnapshot.markdownSources,
  };
  await assert.rejects(
    async () => acceptPhaseHandoff(handoff, loop, shadowMissing, { sourceRoot: directory }),
    (error) => error.code === 'handoff_not_accepted'
      && error.route?.action === 'update_shadow_projection_and_snapshot',
  );

  const invalidLoopContract = structuredClone(loop);
  invalidLoopContract.handoffReceipts = [];
  assert.equal(validateContract(invalidLoopContract, SCHEMA_IDS.loopGraph).valid, false);

  const master = readyMaster(structuredClone(accepted.masterGraph));
  const result = createAcceptanceResult(master, loop, handoff, {
    resultId: 'result.receipt-round7', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.equal(consumePhaseResult(loop, master, handoff, result).action, 'next_phase');

  const deleted = structuredClone(master);
  deleted.handoffReceipts = [];
  for (const operation of [
    () => createAcceptanceResult(deleted, loop, handoff, {
      resultId: 'result.deleted', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    () => consumePhaseResult(loop, deleted, handoff, result),
  ]) assert.throws(operation, (error) => error.exitCode === 3
    && error.code === 'handoff_not_accepted');

  const forgedReceipt = structuredClone(master);
  forgedReceipt.handoffReceipts[0].actorId = 'forged.actor';
  assert.ok((await checkGraph(forgedReceipt)).findings
    .some((item) => item.code === 'handoff_receipt_hash_mismatch'));
  assert.throws(
    () => createAcceptanceResult(forgedReceipt, loop, handoff, {
      resultId: 'result.forged-receipt', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    (error) => error.exitCode === 3 && error.code === 'handoff_receipt_invalid',
  );
});

test('a handoff tampered and rehashed after admission is rejected by all consumers', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const initialMaster = await fixture('valid-master');
  const handoff = createPhaseHandoff(loop, initialMaster, {
    handoffId: 'handoff.rehash-round7', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const accepted = acceptPhaseHandoff(handoff, loop, initialMaster, {
    actorId: 'master.acceptance', acceptedAt: '2026-07-24T10:01:00.000Z',
  });
  const master = readyMaster(structuredClone(accepted.masterGraph));
  const result = createAcceptanceResult(master, loop, handoff, {
    resultId: 'result.rehash-round7', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  const forged = structuredClone(handoff);
  forged.issuedAt = '2026-07-24T10:00:01.000Z';
  forged.projectionHash = phaseHandoffHash(forged);

  for (const operation of [
    () => acceptPhaseHandoff(forged, loop, accepted.masterGraph, {
      actorId: 'master.acceptance', acceptedAt: '2026-07-24T10:02:00.000Z',
    }),
    () => createAcceptanceResult(master, loop, forged, {
      resultId: 'result.forged', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
    }),
    () => consumePhaseResult(loop, master, forged, result),
  ]) assert.throws(operation, (error) => error.exitCode === 3
    && ['handoff_receipt_conflict', 'handoff_receipt_mismatch'].includes(error.code));
});

test('phase result evaluationHash covers every semantic field but is not an admission root', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const initialMaster = await fixture('valid-master');
  const handoff = createPhaseHandoff(loop, initialMaster, {
    handoffId: 'handoff.result-round7', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const accepted = acceptPhaseHandoff(handoff, loop, initialMaster, {
    actorId: 'master.acceptance', acceptedAt: '2026-07-24T10:01:00.000Z',
  });
  const master = readyMaster(structuredClone(accepted.masterGraph));
  const result = createAcceptanceResult(master, loop, handoff, {
    resultId: 'result.identity-round7', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.equal(result.evaluationHash, phaseResultHash(result));

  for (const [field, value] of [
    ['resultId', 'result.forged'],
    ['issuedAt', '2026-07-24T11:00:01.000Z'],
    ['outcome', 'failed'],
  ]) {
    const forged = structuredClone(result);
    forged[field] = value;
    assert.throws(
      () => consumePhaseResult(loop, master, handoff, forged),
      (error) => error.exitCode === 3 && error.code === 'phase_result_hash_mismatch',
      field,
    );
  }

  const rehashed = structuredClone(result);
  rehashed.outcome = 'failed';
  rehashed.evaluationHash = phaseResultHash(rehashed);
  assert.equal(consumePhaseResult(loop, master, handoff, rehashed).action, 'repair_phase');
});

test('Shadow canonical source receipts ignore prose/order but detect deletion and member changes', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-shadow-round7-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'first.md');
  const second = path.join(directory, 'second.md');
  const receipt = {
    schemaVersion: '1.0.0', handoffId: 'handoff.shadow', projectionHash: '1'.repeat(64),
    phaseId: 'phase.shadow', fromGraphId: 'loop.shadow', toGraphId: 'master.shadow',
    acceptedAt: '2026-07-24T10:00:00.000Z', actorId: 'master.acceptance',
  };
  receipt.receiptHash = handoffReceiptHash(receipt);
  const projectionOne = {
    nodes: [{ id: 'req.shadow', type: 'Requirement', status: 'ready', relatedNodeIds: ['task.shadow'] }],
    edges: [], permissions: [], handoffReceipts: [receipt],
  };
  const projectionTwo = {
    nodes: [{ id: 'task.shadow', type: 'Task', status: 'planned', files: ['b.mjs', 'a.mjs'] }],
    edges: [{ id: 'edge.shadow', type: 'implements', from: 'req.shadow', to: 'task.shadow' }], permissions: [],
  };
  const markdown = (title, projection) => `# ${title}\n\n\`\`\`dev-flow-graph\n${JSON.stringify(projection)}\n\`\`\`\n`;
  await writeFile(first, markdown('First', projectionOne));
  await writeFile(second, markdown('Second', projectionTwo));
  const snapshot = await readMarkdownProjection(['second.md', 'first.md'], { sourceRoot: directory });
  const graph = {
    $schema: 'https://dev-flow.dev/schemas/v1/master-graph.schema.json', schemaVersion: '1.0.0',
    graphKind: 'master', id: 'master.shadow', topicRef: 'Docs/shadow',
    authority: {
      mode: 'shadow', sourceOfTruth: 'markdown', syncDirection: 'markdown_to_graph',
      graphMutationAllowed: false, markdownViewReadableAsAuthority: true,
      markdownSources: [...snapshot.markdownSources].reverse(),
    },
    revision: 0, acyclicEdgeTypes: ['depends_on', 'control'], ...snapshot.projection, eventRefs: [],
  };

  const reordered = structuredClone(projectionOne);
  reordered.nodes[0].relatedNodeIds.reverse();
  await writeFile(first, `Prose changed.\n\n${markdown('Reordered', reordered)}`);
  const secondReordered = structuredClone(projectionTwo);
  secondReordered.nodes[0].files.reverse();
  await writeFile(second, markdown('Second reordered', secondReordered));
  assert.deepEqual(await checkShadowDrift(graph, { sourceRoot: directory }), []);

  const changed = structuredClone(secondReordered);
  changed.nodes[0].files.push('real-change.mjs');
  await writeFile(second, markdown('Second changed', changed));
  assert.ok((await checkShadowDrift(graph, { sourceRoot: directory })).some((item) => item.code === 'shadow_drift'));

  await writeFile(second, markdown('Second reordered', secondReordered));
  await unlink(first);
  assert.ok((await checkShadowDrift(graph, { sourceRoot: directory })).some((item) => item.code === 'shadow_drift'));
});
