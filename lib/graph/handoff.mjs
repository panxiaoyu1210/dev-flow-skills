import { SCHEMA_IDS, SCHEMA_VERSION } from './constants.mjs';
import { finding, WorkflowBlockedError, codeUnitCompare } from './errors.mjs';
import { sha256, stableStringify } from './io.mjs';
import { graphHash } from './render.mjs';
import { resolvePhaseCoordinates } from './relations.mjs';
import { validateContract } from './schema.mjs';
import { queryNext } from './next.mjs';

function graphRef(graph) {
  return {
    kind: graph.graphKind,
    id: graph.id,
    hash: graphHash(graph),
    schemaVersion: graph.schemaVersion,
  };
}

function reject(code, message, nodeIds = []) {
  throw new WorkflowBlockedError(code, [finding(
    code, `handoff.${code}`, '/', nodeIds, message,
  )], message);
}

function rejectAdmission(code, message, masterGraph, nodeIds = []) {
  const error = new WorkflowBlockedError(code, [finding(
    code, `handoff.${code}`, '/handoffReceipts', nodeIds, message,
  )], message);
  error.route = masterGraph.authority?.mode === 'shadow'
    ? {
      classification: 'handoff_admission_missing', owner: 'master',
      action: 'update_shadow_projection_and_snapshot',
    }
    : {
      classification: 'handoff_admission_missing', owner: 'master', action: 'reaccept_handoff',
    };
  throw error;
}

async function assertShadowAuthorityCurrent(graph, role, options = {}) {
  if (graph?.authority?.mode !== 'shadow') return;
  const { checkShadowDrift } = await import('./compat.mjs');
  const sourceRoot = options[`${role}SourceRoot`] ?? options.sourceRoot ?? process.cwd();
  const findings = await checkShadowDrift(graph, { sourceRoot });
  if (findings.length === 0) return;
  const error = new WorkflowBlockedError(
    'shadow_drift',
    findings,
    `${role} Shadow Graph differs from its current Markdown authority`,
  );
  error.route = {
    classification: 'shadow_drift',
    owner: role === 'loop' ? 'loop-controller' : 'master',
    action: 'update_shadow_projection_and_snapshot',
  };
  throw error;
}

function withShadowAuthority(loopGraph, masterGraph, options, operation) {
  const hasShadow = loopGraph?.authority?.mode === 'shadow'
    || masterGraph?.authority?.mode === 'shadow';
  if (!hasShadow) return operation();
  return Promise.all([
    assertShadowAuthorityCurrent(loopGraph, 'loop', options),
    assertShadowAuthorityCurrent(masterGraph, 'master', options),
  ]).then(operation);
}

function rejectLoopDrift(message, nodeIds = []) {
  const error = new WorkflowBlockedError('loop_baseline_change', [finding(
    'loop_baseline_change',
    'handoff.stable_loop_coordinates',
    '/',
    nodeIds,
    `${message}; reissue the phase handoff`,
  )], message);
  error.route = {
    classification: 'loop_baseline_change',
    owner: 'loop-controller',
    action: 'reissue_handoff',
  };
  throw error;
}

function assertGraphRef(actual, graph, expectedKind, label) {
  const expected = graphRef(graph);
  for (const field of ['kind', 'id', 'hash', 'schemaVersion']) {
    if (actual?.[field] !== expected[field] || expected.kind !== expectedKind) {
      reject('handoff_graph_mismatch', `${label} ${field} does not match ${expectedKind} Graph`);
    }
  }
}

function assertStableLoopBinding(handoff, loopGraph) {
  const expectedGraph = graphRef(loopGraph);
  for (const field of ['kind', 'id', 'hash', 'schemaVersion']) {
    if (handoff.fromGraph?.[field] !== expectedGraph[field] || expectedGraph.kind !== 'loop') {
      rejectLoopDrift(`Loop Graph ${field} drifted from handoff ${handoff.handoffId}`);
    }
  }
  const byId = new Map(loopGraph.nodes.map((node) => [node.id, node]));
  const phase = byId.get(handoff.phaseId);
  if (!phase || phase.hash !== handoff.phaseHash) {
    rejectLoopDrift(`Loop Phase ${handoff.phaseId} drifted`, [handoff.phaseId]);
  }
  if (phase.type !== 'Phase') rejectLoopDrift(`Loop Phase ${handoff.phaseId} changed type`, [handoff.phaseId]);
  const baseline = byId.get(handoff.baselineId);
  if (!baseline || baseline.type !== 'Baseline' || baseline.hash !== handoff.baselineHash) {
    rejectLoopDrift(`Loop Baseline ${handoff.baselineId} drifted`, [handoff.baselineId]);
  }
  const coordinates = [
    ['Envelope', handoff.envelopeRef, handoff.envelopeSummary],
    ['Budget', handoff.budgetRef, handoff.budgetSummary],
  ];
  for (const [type, ref, summary] of coordinates) {
    const node = byId.get(summary?.id);
    const current = node && { id: node.id, status: node.status, ref: node.ref, hash: node.hash };
    if (!node || node.type !== type || ref !== node.ref || stableStringify(summary) !== stableStringify(current)) {
      rejectLoopDrift(`Loop ${type} control coordinate drifted`, summary?.id ? [summary.id] : []);
    }
  }
  for (const [type, id, statuses] of [
    ['Goal', handoff.goalId, ['active']],
    ['Eval', handoff.evalId, ['passed']],
  ]) {
    const node = byId.get(id);
    if (!node || node.type !== type || !statuses.includes(node.status)) {
      rejectLoopDrift(`Loop ${type} coordinate drifted`, id ? [id] : []);
    }
  }
  const currentCoordinates = resolvePhaseCoordinates(loopGraph, handoff.phaseId);
  const boundCoordinates = {
    goalId: handoff.goalId,
    baselineId: handoff.baselineId,
    envelopeId: handoff.envelopeSummary.id,
    budgetId: handoff.budgetSummary.id,
    evalId: handoff.evalId,
  };
  if (stableStringify(currentCoordinates.controls) !== stableStringify(boundCoordinates)) {
    rejectLoopDrift(`Loop control coordinates drifted from handoff ${handoff.handoffId}`, [
      handoff.phaseId, ...Object.values(boundCoordinates),
    ]);
  }
  return {
    phase,
    baseline,
    goal: byId.get(handoff.goalId),
    envelope: byId.get(handoff.envelopeSummary.id),
    budget: byId.get(handoff.budgetSummary.id),
    evaluation: byId.get(handoff.evalId),
    controls: boundCoordinates,
  };
}

function canonicalStrings(values) {
  return [...new Set(values)].sort(codeUnitCompare);
}

function canonicalObjects(values, key) {
  return [...values].sort((left, right) => codeUnitCompare(
    `${left?.[key] ?? ''}\0${stableStringify(left)}`,
    `${right?.[key] ?? ''}\0${stableStringify(right)}`,
  ));
}

function requirementSummaries(masterGraph, onIncomplete) {
  const summaries = masterGraph.nodes.filter((node) => node.type === 'Requirement')
    .map((node) => {
      if (!node.hash || !node.sourceRevision) onIncomplete(node);
      return {
        id: node.id,
        ref: node.ref ?? node.id,
        hash: node.hash,
        sourceRevision: node.sourceRevision,
      };
    });
  return canonicalObjects(summaries, 'id');
}

function expectedProjection(loopGraph, masterGraph, phase, controls, onIncomplete) {
  const byId = new Map(loopGraph.nodes.map((node) => [node.id, node]));
  const baseline = byId.get(controls.baselineId);
  const envelope = byId.get(controls.envelopeId);
  const budget = byId.get(controls.budgetId);
  const summaries = requirementSummaries(masterGraph, onIncomplete);
  return {
    goalId: controls.goalId,
    evalId: controls.evalId,
    requirementRefs: summaries.map((summary) => summary.id),
    requirementSummaries: summaries,
    artifactRefs: canonicalStrings([phase?.ref, baseline?.ref, ...summaries.map((summary) => summary.ref)]
      .filter(Boolean)),
    envelopeRef: envelope?.ref,
    envelopeSummary: envelope && { id: envelope.id, status: envelope.status, ref: envelope.ref, hash: envelope.hash },
    budgetRef: budget?.ref,
    budgetSummary: budget && { id: budget.id, status: budget.status, ref: budget.ref, hash: budget.hash },
  };
}

function normalizedProjectionValue(key, value) {
  if (key === 'requirementRefs' || key === 'artifactRefs') return canonicalStrings(value);
  if (key === 'requirementSummaries') return canonicalObjects(value, 'id');
  return value;
}

export function phaseHandoffHash(handoff) {
  const { projectionHash: _projectionHash, ...payload } = handoff;
  payload.requirementRefs = canonicalStrings(payload.requirementRefs ?? []);
  payload.requirementSummaries = canonicalObjects(payload.requirementSummaries ?? [], 'id');
  payload.artifactRefs = canonicalStrings(payload.artifactRefs ?? []);
  return sha256(stableStringify(payload));
}

export function handoffReceiptHash(receipt) {
  const { receiptHash: _receiptHash, ...payload } = receipt;
  return sha256(stableStringify(payload));
}

function receiptMatchesHandoff(receipt, handoff, loopGraph, masterGraph) {
  return receipt.handoffId === handoff.handoffId
    && receipt.projectionHash === handoff.projectionHash
    && receipt.phaseId === handoff.phaseId
    && receipt.fromGraphId === loopGraph.id
    && receipt.toGraphId === masterGraph.id;
}

function assertAcceptedHandoffReceipt(handoff, loopGraph, masterGraph) {
  const candidates = (masterGraph.handoffReceipts ?? [])
    .filter((receipt) => receipt.handoffId === handoff.handoffId);
  if (candidates.length === 0) rejectAdmission(
    'handoff_not_accepted',
    `Handoff ${handoff.handoffId} has no persisted acceptance receipt`,
    masterGraph,
    [handoff.phaseId],
  );
  if (candidates.length !== 1) rejectAdmission(
    'handoff_receipt_conflict',
    `Handoff ${handoff.handoffId} has multiple acceptance receipts`,
    masterGraph,
    [handoff.phaseId],
  );
  const receipt = candidates[0];
  if (!validateContract(receipt, SCHEMA_IDS.handoffReceipt).valid) rejectAdmission(
    'handoff_receipt_invalid',
    `Handoff ${handoff.handoffId} acceptance receipt does not satisfy its versioned schema`,
    masterGraph,
    [handoff.phaseId],
  );
  if (receipt.receiptHash !== handoffReceiptHash(receipt)) rejectAdmission(
    'handoff_receipt_invalid',
    `Handoff ${handoff.handoffId} acceptance receipt checksum is invalid`,
    masterGraph,
    [handoff.phaseId],
  );
  if (!receiptMatchesHandoff(receipt, handoff, loopGraph, masterGraph)) rejectAdmission(
    'handoff_receipt_mismatch',
    `Handoff ${handoff.handoffId} does not match its persisted acceptance receipt`,
    masterGraph,
    [handoff.phaseId],
  );
  return receipt;
}

function assertHandoffContentIdentity(handoff) {
  if (handoff.projectionHash !== phaseHandoffHash(handoff)) reject(
    'handoff_projection_hash_mismatch',
    `Handoff ${handoff.handoffId} content does not match its issued projection hash`,
    [handoff.phaseId].filter(Boolean),
  );
}

function assertProjectionBound(handoff, loopGraph, masterGraph, binding) {
  const expected = expectedProjection(
    loopGraph,
    masterGraph,
    binding.phase,
    binding.controls,
    (node) => rejectLoopDrift(`Master Requirement ${node.id} lost stable hash or sourceRevision`, [node.id]),
  );
  for (const key of Object.keys(expected)) {
    const actualValue = normalizedProjectionValue(key, handoff[key]);
    const expectedValue = normalizedProjectionValue(key, expected[key]);
    if (stableStringify(actualValue) !== stableStringify(expectedValue)) {
      rejectLoopDrift(`${key} drifted from handoff ${handoff.handoffId}`, [handoff.phaseId]);
    }
  }
  return expected;
}

function assertHandoffEligibility(loopGraph, phase) {
  const next = queryNext(loopGraph);
  if (phase?.status !== 'ready' || next.action !== 'handoff_phase'
    || !next.targetNodeIds.includes(phase.id) || !next.eligiblePhases.includes(phase.id)) {
    const blockerCodes = next.blockers.map((blocker) => blocker.code).join(', ') || 'phase_not_targeted';
    reject(
      'handoff_phase_not_eligible',
      `Loop next route is ${next.action} with blockers: ${blockerCodes}`,
      [...new Set([phase?.id, ...next.targetNodeIds, ...next.blockers.flatMap((blocker) => [blocker.nodeId, ...(blocker.relatedNodeIds ?? [])])])]
      .filter(Boolean),
    );
  }
  return next;
}

function assertCompleteProjection(handoff, loopGraph, masterGraph) {
  const binding = assertStableLoopBinding(handoff, loopGraph);
  if (handoff.toGraph.kind !== 'master' || handoff.toGraph.id !== masterGraph.id
    || handoff.toGraph.schemaVersion !== masterGraph.schemaVersion) {
    reject('handoff_graph_mismatch', 'Master Graph identity does not match handoff target');
  }
  const projection = assertProjectionBound(handoff, loopGraph, masterGraph, binding);
  return { binding, projection };
}

function evidenceSummariesFor(masterGraph) {
  return canonicalObjects(masterGraph.nodes
    .filter((node) => node.type === 'Evidence' && node.status === 'passed')
    .map((node) => ({
      evidenceId: node.id,
      subjectId: node.subjectId,
      summary: node.summary,
      hash: sha256(stableStringify({
        subjectHash: node.subjectHash,
        sourceRevision: node.sourceRevision,
        summary: node.summary,
      })),
    })), 'evidenceId');
}

function canonicalEvaluationPayload(value) {
  const { evaluationHash: _evaluationHash, ...payload } = value;
  payload.requirementIds = canonicalStrings(payload.requirementIds ?? []);
  payload.evidenceSummaries = canonicalObjects(payload.evidenceSummaries ?? [], 'evidenceId');
  return payload;
}

export function phaseResultHash(result) {
  return sha256(stableStringify(canonicalEvaluationPayload(result)));
}

function acceptanceReadinessFindings(masterGraph, now) {
  const findings = [];
  const schema = validateContract(masterGraph, SCHEMA_IDS.masterGraph);
  for (const error of schema.errors) findings.push(finding(
    'acceptance_graph_invalid', `acceptance.schema.${error.keyword}`, error.instancePath || '/', [],
    `Master Graph ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
  ));
  const nodes = Array.isArray(masterGraph?.nodes) ? masterGraph.nodes : [];
  const edges = Array.isArray(masterGraph?.edges) ? masterGraph.edges : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const requirements = nodes.filter((node) => node.type === 'Requirement');
  if (requirements.length === 0) findings.push(finding(
    'acceptance_scope_missing', 'acceptance.requirement_scope_nonempty', '/nodes', [],
    'Passing acceptance requires a non-empty Requirement scope',
  ));
  for (const requirement of requirements) {
    const hasTask = edges.some((edge) => edge.type === 'implements'
      && edge.from === requirement.id && byId.get(edge.to)?.type === 'Task');
    const hasTest = edges.some((edge) => edge.type === 'verifies'
      && edge.to === requirement.id && byId.get(edge.from)?.type === 'Test');
    if (!hasTask || !hasTest) findings.push(finding(
      'acceptance_coverage_gap', 'acceptance.requirement_task_test_coverage', '/edges', [requirement.id],
      `Requirement ${requirement.id} lacks ${[!hasTask && 'Task', !hasTest && 'Test'].filter(Boolean).join(' and ')} coverage`,
    ));
  }
  const expected = {
    Requirement: new Set(['complete']),
    Task: new Set(['complete']),
    Gate: new Set(['passed']),
    Test: new Set(['passed', 'complete']),
    Git: new Set(['complete']),
    Failure: new Set(['resolved']),
  };
  for (const node of nodes) {
    if (expected[node.type] && !expected[node.type].has(node.status)) findings.push(finding(
      'acceptance_not_ready',
      `acceptance.${node.type.toLowerCase()}_ready`,
      '/nodes',
      [node.id],
      `${node.type} ${node.id} is ${node.status}, not acceptance-ready`,
    ));
    if (node.type === 'Evidence') {
      const subject = byId.get(node.subjectId);
      const fresh = node.status === 'passed'
        && node.subjectHash === subject?.hash
        && node.sourceRevision === subject?.sourceRevision
        && Date.parse(node.expiresAt) > now;
      if (!fresh) findings.push(finding(
        'acceptance_not_ready', 'acceptance.evidence_fresh', '/nodes', [node.id],
        `Evidence ${node.id} is not fresh and passed`,
      ));
    }
  }
  return findings;
}

function createPhaseHandoffCore(loopGraph, masterGraph, options) {
  if (loopGraph.graphKind !== 'loop' || masterGraph.graphKind !== 'master') {
    reject('handoff_graph_kind', 'Phase handoff requires separate Loop and Master Graphs');
  }
  const byId = new Map(loopGraph.nodes.map((node) => [node.id, node]));
  const phase = byId.get(options.phaseId);
  const next = assertHandoffEligibility(loopGraph, phase);
  const controls = next.controls;
  const baseline = byId.get(controls.baselineId);
  const envelope = byId.get(controls.envelopeId);
  const budget = byId.get(controls.budgetId);
  if (phase?.type !== 'Phase' || baseline?.type !== 'Baseline' || envelope?.type !== 'Envelope'
    || budget?.type !== 'Budget' || !phase.hash || !baseline.hash
    || !envelope.ref || !envelope.hash || !budget.ref || !budget.hash) {
    reject('handoff_reference_missing', 'Loop phase handoff requires phase, hashed baseline, envelope, and budget references');
  }
  const projection = expectedProjection(
    loopGraph,
    masterGraph,
    phase,
    controls,
    (node) => reject(
      'handoff_requirement_incomplete',
      `Requirement ${node.id} requires stable hash and sourceRevision before handoff`,
      [node.id],
    ),
  );
  if (projection.requirementRefs.length === 0) reject(
    'requirement_scope_missing',
    'Phase handoff requires at least one stable Master Requirement reference',
  );
  const handoff = {
    schemaVersion: SCHEMA_VERSION,
    handoffId: options.handoffId,
    direction: 'loop_to_master',
    phaseId: phase.id,
    phaseHash: phase.hash,
    fromGraph: graphRef(loopGraph),
    toGraph: graphRef(masterGraph),
    baselineId: baseline.id,
    baselineHash: baseline.hash,
    ...projection,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
  };
  return { ...handoff, projectionHash: phaseHandoffHash(handoff) };
}

function acceptPhaseHandoffCore(handoff, loopGraph, masterGraph, options = {}) {
  const schema = validateContract(handoff, SCHEMA_IDS.phaseHandoff);
  if (!schema.valid) reject('handoff_schema_invalid', 'Phase handoff does not satisfy its versioned schema');
  assertHandoffContentIdentity(handoff);
  const { binding } = assertCompleteProjection(handoff, loopGraph, masterGraph);
  assertGraphRef(handoff.fromGraph, loopGraph, 'loop', 'fromGraph');
  const next = assertHandoffEligibility(loopGraph, binding.phase);
  if (stableStringify(next.controls) !== stableStringify({
    goalId: handoff.goalId,
    baselineId: handoff.baselineId,
    envelopeId: handoff.envelopeSummary.id,
    budgetId: handoff.budgetSummary.id,
    evalId: handoff.evalId,
  })) reject('handoff_control_mismatch', 'Handoff controls do not match the current next coordinates', [binding.phase.id]);
  const existing = (masterGraph.handoffReceipts ?? [])
    .filter((receipt) => receipt.handoffId === handoff.handoffId);
  if (existing.length > 0) {
    let receipt;
    try {
      receipt = assertAcceptedHandoffReceipt(handoff, loopGraph, masterGraph);
    } catch (error) {
      if (error.code === 'handoff_receipt_mismatch' || error.code === 'handoff_receipt_invalid') {
        rejectAdmission(
          'handoff_receipt_conflict',
          `Persisted receipt for ${handoff.handoffId} conflicts with the proposed handoff`,
          masterGraph,
          [handoff.phaseId],
        );
      }
      throw error;
    }
    return {
      accepted: true,
      alreadyAccepted: true,
      receipt,
      masterGraph: structuredClone(masterGraph),
      handoffId: handoff.handoffId,
      phaseId: binding.phase.id,
      baselineRef: { id: binding.baseline.id, hash: binding.baseline.hash },
      envelopeRef: handoff.envelopeRef,
      budgetRef: handoff.budgetRef,
    };
  }
  if (masterGraph.authority?.mode === 'shadow') rejectAdmission(
    'handoff_not_accepted',
    `Shadow Master Graph requires ${handoff.handoffId} receipt in Markdown projection and a new snapshot`,
    masterGraph,
    [handoff.phaseId],
  );
  if (masterGraph.authority?.mode !== 'graph' || !masterGraph.authority.graphMutationAllowed) reject(
    'authority_read_only',
    `${masterGraph.authority?.mode ?? 'legacy'} Master Graph cannot persist handoff admission`,
  );
  assertGraphRef(handoff.toGraph, masterGraph, 'master', 'toGraph');
  const receiptBase = {
    schemaVersion: SCHEMA_VERSION,
    handoffId: handoff.handoffId,
    projectionHash: handoff.projectionHash,
    phaseId: handoff.phaseId,
    fromGraphId: loopGraph.id,
    toGraphId: masterGraph.id,
    acceptedAt: options.acceptedAt ?? new Date().toISOString(),
    actorId: options.actorId ?? 'dev-flow-master',
  };
  const receipt = { ...receiptBase, receiptHash: handoffReceiptHash(receiptBase) };
  const updatedMasterGraph = structuredClone(masterGraph);
  updatedMasterGraph.handoffReceipts = [...(updatedMasterGraph.handoffReceipts ?? []), receipt];
  updatedMasterGraph.handoffReceipts.sort((left, right) => codeUnitCompare(
    `${left.handoffId}\0${left.projectionHash}`,
    `${right.handoffId}\0${right.projectionHash}`,
  ));
  updatedMasterGraph.revision += 1;
  const updatedSchema = validateContract(updatedMasterGraph, SCHEMA_IDS.masterGraph);
  if (!updatedSchema.valid) reject(
    'handoff_receipt_invalid',
    `Acceptance receipt does not satisfy Master Graph schema: ${updatedSchema.errors[0]?.message ?? 'invalid'}`,
    [handoff.phaseId],
  );
  return {
    accepted: true,
    alreadyAccepted: false,
    receipt,
    masterGraph: updatedMasterGraph,
    handoffId: handoff.handoffId,
    phaseId: binding.phase.id,
    baselineRef: { id: binding.baseline.id, hash: binding.baseline.hash },
    envelopeRef: handoff.envelopeRef,
    budgetRef: handoff.budgetRef,
  };
}

function createAcceptanceResultCore(masterGraph, loopGraph, handoff, options) {
  const schema = validateContract(handoff, SCHEMA_IDS.phaseHandoff);
  if (!schema.valid) reject('handoff_schema_invalid', 'Phase handoff does not satisfy its versioned schema');
  assertHandoffContentIdentity(handoff);
  const { projection } = assertCompleteProjection(handoff, loopGraph, masterGraph);
  assertAcceptedHandoffReceipt(handoff, loopGraph, masterGraph);
  if (handoff.fromGraph.kind !== 'loop' || handoff.fromGraph.id !== loopGraph.id
    || handoff.fromGraph.schemaVersion !== loopGraph.schemaVersion) {
    reject('handoff_graph_mismatch', 'Acceptance Loop Graph identity does not match handoff source');
  }
  const requirementIds = projection.requirementRefs;
  if (options.outcome === 'passed') {
    const readiness = acceptanceReadinessFindings(masterGraph, new Date(options.issuedAt ?? Date.now()).getTime());
    if (readiness.length > 0) throw new WorkflowBlockedError('acceptance_not_ready', readiness, 'Master Graph is not acceptance-ready');
  }
  const evidenceSummaries = evidenceSummariesFor(masterGraph);
  const outcome = options.outcome;
  const handoffHash = handoff.projectionHash;
  const result = {
    schemaVersion: SCHEMA_VERSION,
    resultId: options.resultId,
    resultType: 'acceptance',
    direction: 'master_to_loop',
    handoffId: handoff.handoffId,
    phaseId: handoff.phaseId,
    masterGraph: graphRef(masterGraph),
    loopGraph: graphRef(loopGraph),
    outcome,
    handoffHash,
    requirementIds,
    evidenceSummaries,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
  };
  return { ...result, evaluationHash: phaseResultHash(result) };
}

function consumePhaseResultCore(loopGraph, masterGraph, handoff, result) {
  const schema = validateContract(result, SCHEMA_IDS.phaseResult);
  if (!schema.valid) reject('phase_result_schema_invalid', 'Phase result does not satisfy its versioned schema');
  const handoffSchema = validateContract(handoff, SCHEMA_IDS.phaseHandoff);
  if (!handoffSchema.valid) reject('handoff_schema_invalid', 'Phase handoff does not satisfy its versioned schema');
  assertHandoffContentIdentity(handoff);
  const { binding, projection } = assertCompleteProjection(handoff, loopGraph, masterGraph);
  assertAcceptedHandoffReceipt(handoff, loopGraph, masterGraph);
  if (result.resultType !== 'acceptance' || result.direction !== 'master_to_loop') {
    reject('phase_result_type_mismatch', 'Loop phase evaluation consumes a Master acceptance result');
  }
  if (result.handoffId !== handoff.handoffId || result.phaseId !== handoff.phaseId) {
    reject('phase_result_handoff_mismatch', 'Phase result does not match the accepted handoff', [result.phaseId]);
  }
  if (result.handoffHash !== handoff.projectionHash) reject(
    'phase_result_handoff_hash_mismatch',
    'Phase result is not bound to the issued handoff projection hash',
    [result.phaseId],
  );
  const expectedRequirementIds = projection.requirementRefs;
  if (stableStringify(canonicalStrings(result.requirementIds)) !== stableStringify(expectedRequirementIds)) {
    rejectLoopDrift(`Phase result Requirement scope drifted from handoff ${handoff.handoffId}`, [
      ...result.requirementIds, ...expectedRequirementIds,
    ]);
  }
  assertGraphRef(result.loopGraph, loopGraph, 'loop', 'loopGraph');
  assertGraphRef(result.masterGraph, masterGraph, 'master', 'masterGraph');
  const expectedEvidenceSummaries = evidenceSummariesFor(masterGraph);
  if (stableStringify(canonicalObjects(result.evidenceSummaries, 'evidenceId'))
    !== stableStringify(expectedEvidenceSummaries)) {
    reject('phase_result_evidence_mismatch', 'Phase result evidence does not match the current Master Graph');
  }
  const expectedHash = phaseResultHash(result);
  if (result.evaluationHash !== expectedHash) reject('phase_result_hash_mismatch', 'Phase result evaluation hash does not match');
  if (result.outcome === 'passed') {
    const readiness = acceptanceReadinessFindings(masterGraph, new Date(result.issuedAt).getTime());
    if (readiness.length > 0) throw new WorkflowBlockedError('acceptance_not_ready', readiness, 'Passing result does not come from an acceptance-ready Master Graph');
  }
  let action;
  if (['exhausted', 'stopped'].includes(binding.budget.status)) action = 'stop';
  else if (result.outcome === 'passed') action = 'next_phase';
  else if (result.outcome === 'failed') action = 'repair_phase';
  else action = 'stop_for_review';
  return {
    schemaVersion: SCHEMA_VERSION,
    resultType: 'phase_eval',
    phaseId: result.phaseId,
    outcome: result.outcome,
    action,
    acceptanceResultId: result.resultId,
    acceptanceHash: sha256(stableStringify(result)),
  };
}

function createPhaseEvaluationResultCore(loopGraph, masterGraph, handoff, acceptance, options) {
  consumePhaseResultCore(loopGraph, masterGraph, handoff, acceptance);
  const payload = canonicalEvaluationPayload(acceptance);
  const result = {
    schemaVersion: SCHEMA_VERSION,
    resultId: options.resultId,
    resultType: 'phase_eval',
    direction: 'loop_internal',
    handoffId: handoff.handoffId,
    phaseId: handoff.phaseId,
    masterGraph: acceptance.masterGraph,
    loopGraph: graphRef(loopGraph),
    outcome: payload.outcome,
    handoffHash: payload.handoffHash,
    requirementIds: payload.requirementIds,
    evidenceSummaries: payload.evidenceSummaries,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
  };
  return { ...result, evaluationHash: phaseResultHash(result) };
}

export function createPhaseHandoff(loopGraph, masterGraph, options) {
  return withShadowAuthority(
    loopGraph,
    masterGraph,
    options,
    () => createPhaseHandoffCore(loopGraph, masterGraph, options),
  );
}

export function acceptPhaseHandoff(handoff, loopGraph, masterGraph, options = {}) {
  return withShadowAuthority(
    loopGraph,
    masterGraph,
    options,
    () => acceptPhaseHandoffCore(handoff, loopGraph, masterGraph, options),
  );
}

export function createAcceptanceResult(masterGraph, loopGraph, handoff, options) {
  return withShadowAuthority(
    loopGraph,
    masterGraph,
    options,
    () => createAcceptanceResultCore(masterGraph, loopGraph, handoff, options),
  );
}

export function consumePhaseResult(loopGraph, masterGraph, handoff, result, options = {}) {
  return withShadowAuthority(
    loopGraph,
    masterGraph,
    options,
    () => consumePhaseResultCore(loopGraph, masterGraph, handoff, result),
  );
}

export function createPhaseEvaluationResult(loopGraph, masterGraph, handoff, acceptance, options) {
  return withShadowAuthority(
    loopGraph,
    masterGraph,
    options,
    () => createPhaseEvaluationResultCore(loopGraph, masterGraph, handoff, acceptance, options),
  );
}
