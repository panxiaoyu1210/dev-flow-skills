import { DECLARABLE_ACYCLIC_EDGE_TYPES } from './constants.mjs';
import { findCycles } from './dag.mjs';
import { handoffReceiptHash } from './handoff.mjs';
import { stableStringify, sha256 } from './io.mjs';
import { queryNext } from './next.mjs';
import { resolvePhaseEvalRelation } from './relations.mjs';
import { validateEventSchema, validateGraphSchema } from './schema.mjs';

function finding(code, rule, path, nodeIds, message) {
  return {
    code,
    rule,
    path,
    nodeIds: [...new Set(nodeIds)].sort(),
    message,
  };
}

function findingComparator(left, right) {
  const leftKey = stableStringify(left);
  const rightKey = stableStringify(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function schemaFindings(graph, errors) {
  const findings = errors.map((error) => {
    const match = /^\/nodes\/(\d+)/.exec(error.instancePath);
    const nodeId = match ? graph?.nodes?.[Number(match[1])]?.id : undefined;
    const path = error.instancePath || '/';
    return finding(
      'schema_invalid',
      `json_schema.${error.keyword}`,
      path,
      nodeId ? [nodeId] : [],
      `${path} ${error.message ?? 'is invalid'}`,
    );
  });
  const unique = new Map();
  for (const item of findings) unique.set(stableStringify(item), item);
  return [...unique.values()];
}

function duplicateFindings(graph) {
  const findings = [];
  for (const collection of ['nodes', 'edges', 'permissions', 'eventRefs']) {
    const firstIndex = new Map();
    graph[collection].forEach((item, index) => {
      if (!firstIndex.has(item.id)) {
        firstIndex.set(item.id, index);
        return;
      }
      findings.push(finding(
        'duplicate_id',
        'identity.unique_within_collection',
        `/${collection}/${index}/id`,
        collection === 'nodes' ? [item.id] : [],
        `Duplicate ${collection} ID: ${item.id}`,
      ));
    });
  }
  const receiptIds = new Map();
  for (const [index, receipt] of (graph.handoffReceipts ?? []).entries()) {
    if (!receiptIds.has(receipt.handoffId)) {
      receiptIds.set(receipt.handoffId, index);
      continue;
    }
    findings.push(finding(
      'duplicate_handoff_receipt',
      'identity.one_receipt_per_handoff',
      `/handoffReceipts/${index}/handoffId`,
      [receipt.phaseId],
      `Duplicate handoff receipt: ${receipt.handoffId}`,
    ));
  }
  return findings;
}

function handoffReceiptFindings(graph) {
  if (graph.graphKind !== 'master') return [];
  const findings = [];
  for (const [index, receipt] of graph.handoffReceipts.entries()) {
    if (receipt.toGraphId !== graph.id) findings.push(finding(
      'handoff_receipt_graph_mismatch',
      'handoff_receipt.to_graph_matches_authority',
      `/handoffReceipts/${index}/toGraphId`,
      [receipt.phaseId],
      `Handoff receipt ${receipt.handoffId} targets ${receipt.toGraphId}, not ${graph.id}`,
    ));
    if (receipt.receiptHash !== handoffReceiptHash(receipt)) findings.push(finding(
      'handoff_receipt_hash_mismatch',
      'handoff_receipt.canonical_hash_matches',
      `/handoffReceipts/${index}/receiptHash`,
      [receipt.phaseId],
      `Handoff receipt ${receipt.handoffId} checksum does not match its content`,
    ));
  }
  return findings;
}

function missingReferenceFindings(graph) {
  const findings = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const permissionIds = new Set(graph.permissions.map((permission) => permission.id));
  const eventIds = new Set(graph.eventRefs.map((eventRef) => eventRef.id));

  graph.edges.forEach((edge, index) => {
    for (const endpoint of ['from', 'to']) {
      if (!nodeIds.has(edge[endpoint])) {
        findings.push(finding(
          'missing_reference',
          'relations.reference_exists',
          `/edges/${index}/${endpoint}`,
          [edge[endpoint]],
          `Edge ${edge.id} references missing node ${edge[endpoint]}`,
        ));
      }
    }
  });

  const relationCollections = [
    ['prerequisiteIds', nodeIds],
    ['relatedNodeIds', nodeIds],
    ['evidenceIds', nodeIds],
    ['permissionIds', permissionIds],
    ['eventRefIds', eventIds],
  ];
  graph.nodes.forEach((node, nodeIndex) => {
    if (node.subjectId && !nodeIds.has(node.subjectId)) {
      findings.push(finding(
        'missing_reference',
        'relations.reference_exists',
        `/nodes/${nodeIndex}/subjectId`,
        [node.id, node.subjectId],
        `Node ${node.id} references missing subject ${node.subjectId}`,
      ));
    }
    for (const [property, ids] of relationCollections) {
      (node[property] ?? []).forEach((referencedId, relationIndex) => {
        if (ids.has(referencedId)) return;
        findings.push(finding(
          'missing_reference',
          'relations.reference_exists',
          `/nodes/${nodeIndex}/${property}/${relationIndex}`,
          [node.id, referencedId],
          `Node ${node.id} references missing ${property} value ${referencedId}`,
        ));
      });
    }
  });
  return findings;
}

function cycleFindings(graph) {
  const declaredPrerequisites = graph.nodes.flatMap((node, nodeIndex) =>
    (node.prerequisiteIds ?? []).map((prerequisiteId, prerequisiteIndex) => ({
      id: `declared-prerequisite.${nodeIndex}.${prerequisiteIndex}`,
      type: 'depends_on',
      from: node.id,
      to: prerequisiteId,
    })));
  return findCycles(
    graph.nodes,
    [...graph.edges, ...declaredPrerequisites],
    DECLARABLE_ACYCLIC_EDGE_TYPES,
  ).map((nodeIds) => finding(
    'dag_cycle',
    'dag.declared_edges_acyclic',
    '/edges',
    nodeIds,
    `Declared acyclic edges form a cycle across: ${nodeIds.join(', ')}`,
  ));
}

function coverageFindings(graph) {
  if (graph.graphKind !== 'master') return [];
  const findings = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const requirement of graph.nodes.filter((node) => node.type === 'Requirement')) {
    const hasTask = graph.edges.some((edge) => {
      if (edge.type !== 'implements') return false;
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      return from?.id === requirement.id && to?.type === 'Task';
    });
    if (!hasTask) {
      findings.push(finding(
        'requirement_task_coverage_gap',
        'coverage.requirement_has_task',
        '/edges',
        [requirement.id],
        `Requirement ${requirement.id} has no implementing Task`,
      ));
    }

    const hasTest = graph.edges.some((edge) => {
      if (edge.type !== 'verifies') return false;
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      return from?.type === 'Test' && to?.id === requirement.id;
    });
    if (!hasTest) {
      findings.push(finding(
        'test_requirement_coverage_gap',
        'coverage.requirement_has_test',
        '/edges',
        [requirement.id],
        `Requirement ${requirement.id} has no verifying Test`,
      ));
    }
  }
  return findings;
}

function overlap(left, right, property) {
  const leftValues = new Set(left[property] ?? []);
  return (right[property] ?? []).filter((value) => leftValues.has(value)).sort();
}

function overlapFindings(graph) {
  if (graph.graphKind !== 'master') return [];
  const tasks = graph.nodes.filter((node) => node.type === 'Task' && node.parallelGroup);
  const findings = [];
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex];
      const right = tasks[rightIndex];
      if (left.parallelGroup !== right.parallelGroup) continue;
      if (left.forcedSerial || right.forcedSerial) continue;
      if (left.safeIntegrationRef && left.safeIntegrationRef === right.safeIntegrationRef) continue;
      const files = overlap(left, right, 'files');
      const symbols = overlap(left, right, 'symbols');
      if (files.length === 0 && symbols.length === 0) continue;
      findings.push(finding(
        'parallel_overlap_conflict',
        'parallelism.high_overlap_requires_coordination',
        '/nodes',
        [left.id, right.id],
        `Parallel tasks overlap on ${[...files, ...symbols].join(', ')}`,
      ));
    }
  }
  return findings;
}

function gateFindings(graph) {
  if (graph.graphKind !== 'master') return [];
  const findings = [];
  graph.nodes.forEach((node, index) => {
    if (node.type !== 'Gate') return;
    if (!node.prerequisiteIds || node.prerequisiteIds.length === 0) {
      findings.push(finding(
        'gate_prerequisite_missing',
        'gate.prerequisites_declared',
        `/nodes/${index}/prerequisiteIds`,
        [node.id],
        `Gate ${node.id} has no declared prerequisite`,
      ));
    }
  });
  return findings;
}

function reviewerFindings(graph) {
  const findings = [];
  graph.nodes.forEach((node, index) => {
    const maker = node.makerActorId ?? node.actorId;
    if (!maker || !node.reviewerActorId || maker !== node.reviewerActorId) return;
    findings.push(finding(
      'reviewer_not_independent',
      'review.maker_checker_independence',
      `/nodes/${index}/reviewerActorId`,
      [node.id],
      `Node ${node.id} assigns the maker as reviewer`,
    ));
  });
  return findings;
}

function evidenceExpiryFinding(node, index) {
  if (node.type !== 'Evidence' || !Object.hasOwn(node, 'expiresAt')) return undefined;
  if (Number.isFinite(Date.parse(node.expiresAt))) return undefined;
  return finding(
    'evidence_expiry_invalid',
    'evidence.expiry_parseable',
    `/nodes/${index}/expiresAt`,
    [node.id],
    `Evidence ${node.id} expiresAt is not a finite UTC instant`,
  );
}

function evidenceFindings(graph, now) {
  const findings = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  graph.nodes.forEach((node, index) => {
    if (node.type !== 'Evidence' || !node.subjectId) return;
    const invalidExpiry = evidenceExpiryFinding(node, index);
    if (invalidExpiry) {
      findings.push(invalidExpiry);
      return;
    }
    const subject = nodesById.get(node.subjectId);
    if (!subject) return;
    const hashMismatch = !subject.hash || node.subjectHash !== subject.hash;
    const revisionMismatch = !subject.sourceRevision || node.sourceRevision !== subject.sourceRevision;
    const expired = Date.parse(node.expiresAt) <= now;
    if (!hashMismatch && !revisionMismatch && !expired) return;
    const reasons = [];
    if (hashMismatch) reasons.push('subject hash');
    if (revisionMismatch) reasons.push('source revision');
    if (expired) reasons.push('expiry');
    findings.push(finding(
      'evidence_stale',
      'evidence.subject_hash_and_revision_match',
      `/nodes/${index}`,
      [node.id, subject.id],
      `Evidence ${node.id} is stale by ${reasons.join(', ')} for subject ${subject.id}`,
    ));
  });
  return findings;
}

function permissionFindings(graph) {
  const findings = [];
  for (let leftIndex = 0; leftIndex < graph.permissions.length; leftIndex += 1) {
    const left = graph.permissions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < graph.permissions.length; rightIndex += 1) {
      const right = graph.permissions[rightIndex];
      const sameSubject = left.actorId === right.actorId && left.action === right.action;
      const overlappingResource = left.resourceRef === right.resourceRef
        || left.resourceRef === '*' || right.resourceRef === '*';
      if (!sameSubject || !overlappingResource || left.effect === right.effect) continue;
      findings.push(finding(
        'permission_conflict',
        'permissions.no_grant_deny_conflict',
        `/permissions/${leftIndex}`,
        [],
        `Permission conflict for ${left.actorId} ${left.action} across ${left.resourceRef} and ${right.resourceRef}`,
      ));
    }
  }
  return findings;
}

function loopRelationFindings(graph) {
  if (graph.graphKind !== 'loop') return [];
  const findings = [];
  for (const [index, phase] of graph.nodes.entries()) {
    if (phase.type !== 'Phase') continue;
    const relation = resolvePhaseEvalRelation(graph, phase.id);
    if (relation.status === 'resolved') continue;
    const code = relation.status === 'missing'
      ? 'phase_eval_relation_missing'
      : relation.status === 'shared' ? 'phase_eval_relation_shared' : 'phase_eval_relation_ambiguous';
    findings.push(finding(
      code,
      'relations.phase_has_one_unshared_eval',
      `/nodes/${index}/relatedNodeIds`,
      [phase.id, ...(relation.evalIds ?? []), ...(relation.phaseIds ?? [])],
      `Phase ${phase.id} has ${relation.status} Eval relation`,
    ));
  }
  const next = queryNext(graph);
  if (next.action === 'resolve_current_goal') {
    for (const blocker of next.blockers) findings.push(finding(
      blocker.code,
      'relations.current_goal_resolved',
      '/nodes',
      [blocker.nodeId, ...(blocker.relatedNodeIds ?? []), ...next.targetNodeIds].filter(Boolean),
      `Loop current Goal is unresolved: ${blocker.code}`,
    ));
  }
  const premature = next.blockers.find((blocker) => blocker.code === 'premature_goal_completion');
  if (next.action === 'resolve_terminal_inconsistency' && premature) findings.push(finding(
      'premature_goal_completion',
      'terminal.goal_completion_consistent',
      '/nodes',
      [premature.nodeId, ...next.targetNodeIds].filter(Boolean),
      `Completed Goal is inconsistent with ${next.blockers.map((blocker) => blocker.code).join(', ')}`,
    ));
  return findings;
}

async function eventFindings(graph, eventResolver) {
  if (graph.eventRefs.length === 0) return [];
  if (!eventResolver) {
    return [finding(
      'event_resolver_required',
      'events.references_must_be_resolved',
      '/eventRefs',
      [],
      'Graph event references require a runtime event resolver',
    )];
  }
  const findings = [];
  for (let index = 0; index < graph.eventRefs.length; index += 1) {
    const eventRef = graph.eventRefs[index];
    const event = await eventResolver(eventRef);
    if (event === undefined || event === null) {
      findings.push(finding(
        'event_reference_missing',
        'events.reference_exists',
        `/eventRefs/${index}`,
        [],
        `Runtime event ${eventRef.id} does not exist`,
      ));
      continue;
    }
    let normalized;
    try {
      normalized = typeof event === 'string' || Buffer.isBuffer(event)
        ? JSON.parse(event.toString())
        : event;
    } catch {
      findings.push(finding(
        'event_schema_invalid',
        'events.schema_valid',
        `/eventRefs/${index}`,
        [],
        `Runtime event ${eventRef.id} is not valid JSON`,
      ));
      continue;
    }
    const schemaResult = validateEventSchema(normalized);
    for (const error of schemaResult.errors) {
      findings.push(finding(
        'event_schema_invalid',
        `events.schema.${error.keyword}`,
        `/eventRefs/${index}${error.instancePath}`,
        [],
        `Runtime event ${eventRef.id} ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
      ));
    }
    if (normalized?.id !== eventRef.id) {
      findings.push(finding(
        'event_id_mismatch',
        'events.id_matches_reference',
        `/eventRefs/${index}/id`,
        [],
        `Runtime event ID ${normalized?.id ?? '<missing>'} does not match reference ${eventRef.id}`,
      ));
    }
    if (normalized?.graphId !== graph.id) {
      findings.push(finding(
        'event_graph_mismatch',
        'events.graph_id_matches',
        `/eventRefs/${index}`,
        [],
        `Runtime event ${eventRef.id} belongs to graph ${normalized?.graphId ?? '<missing>'}, not ${graph.id}`,
      ));
    }
    if (sha256(stableStringify(normalized)) !== eventRef.hash) {
      findings.push(finding(
        'event_hash_mismatch',
        'events.hash_matches',
        `/eventRefs/${index}/hash`,
        [],
        `Runtime event ${eventRef.id} hash does not match`,
      ));
    }
  }
  return findings;
}

export async function checkGraph(graph, options = {}) {
  const schemaResult = validateGraphSchema(graph);
  if (!schemaResult.valid) {
    const findings = schemaFindings(graph, schemaResult.errors).sort(findingComparator);
    return { valid: false, findings };
  }

  const now = options.now === undefined ? Date.now() : new Date(options.now).getTime();
  if (!Number.isFinite(now)) throw new TypeError('checkGraph options.now must be a valid date');

  const findings = [
    ...duplicateFindings(graph),
    ...missingReferenceFindings(graph),
    ...cycleFindings(graph),
    ...coverageFindings(graph),
    ...overlapFindings(graph),
    ...gateFindings(graph),
    ...reviewerFindings(graph),
    ...evidenceFindings(graph, now),
    ...permissionFindings(graph),
    ...handoffReceiptFindings(graph),
    ...loopRelationFindings(graph),
    ...await eventFindings(graph, options.eventResolver),
  ].sort(findingComparator);

  return { valid: findings.length === 0, findings };
}
