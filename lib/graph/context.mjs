import { SCHEMA_VERSION } from './constants.mjs';
import { WorkflowBlockedError, codeUnitCompare, finding } from './errors.mjs';
import { sha256, stableStringify } from './io.mjs';
import { queryNext } from './next.mjs';
import { graphHash } from './render.mjs';

function freshEvidence(evidence, subject, now) {
  return evidence.type === 'Evidence'
    && evidence.status === 'passed'
    && evidence.subjectHash === subject?.hash
    && evidence.sourceRevision === subject?.sourceRevision
    && Date.parse(evidence.expiresAt) > now;
}

function associatedIds(graph, selectedIds, blockers = []) {
  const blockerIds = blockers.flatMap((blocker) => [blocker.nodeId, ...(blocker.relatedNodeIds ?? [])]).filter(Boolean);
  const ids = new Set([...selectedIds, ...blockerIds]);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const selectedId of [...ids]) {
    const node = byId.get(selectedId);
    for (const prerequisiteId of node?.prerequisiteIds ?? []) ids.add(prerequisiteId);
    for (const relatedId of node?.relatedNodeIds ?? []) ids.add(relatedId);
    for (const evidenceId of node?.evidenceIds ?? []) ids.add(evidenceId);
    if (node?.subjectId) ids.add(node.subjectId);
    for (const edge of graph.edges) {
      const touches = edge.from === selectedId || edge.to === selectedId;
      if (!touches) continue;
      const otherId = edge.from === selectedId ? edge.to : edge.from;
      const other = byId.get(otherId);
      if (['Requirement', 'Test', 'Gate', 'Evidence', 'Goal', 'Baseline', 'Envelope', 'Budget', 'Eval'].includes(other?.type)) ids.add(otherId);
      if (edge.type === 'depends_on' && edge.from === selectedId) ids.add(edge.to);
    }
  }
  for (const edge of graph.edges) {
    if (edge.type === 'verifies' && ids.has(edge.to)) ids.add(edge.from);
    if (edge.type === 'evidences' && ids.has(edge.to)) ids.add(edge.from);
  }
  for (const evidence of graph.nodes.filter((node) => node.type === 'Evidence')) {
    if (ids.has(evidence.subjectId)) ids.add(evidence.id);
  }
  const governedIds = new Set([...ids]);
  for (const nodeId of governedIds) {
    const node = byId.get(nodeId);
    for (const relatedId of node?.relatedNodeIds ?? []) {
      if (byId.get(relatedId)?.type === 'Gate') ids.add(relatedId);
    }
  }
  for (const gate of graph.nodes.filter((node) => node.type === 'Gate')) {
    if ((gate.relatedNodeIds ?? []).some((id) => governedIds.has(id))) ids.add(gate.id);
  }
  for (const edge of graph.edges) {
    if (edge.type === 'requires' && governedIds.has(edge.from) && byId.get(edge.to)?.type === 'Gate') ids.add(edge.to);
  }
  for (const gateId of [...ids].filter((id) => byId.get(id)?.type === 'Gate')) {
    for (const prerequisiteId of byId.get(gateId).prerequisiteIds ?? []) ids.add(prerequisiteId);
  }
  return ids;
}

export function buildMinimalContext(graph, options = {}) {
  const next = queryNext(graph);
  if (options.nodeId && !graph.nodes.some((node) => node.id === options.nodeId)) {
    throw new WorkflowBlockedError('node_not_found', [finding(
      'node_not_found', 'context.target_exists', '/nodeId', [options.nodeId],
      `Context target ${options.nodeId} does not exist`,
    )]);
  }
  const selectedNodeIds = options.nodeId
    ? [options.nodeId]
    : next.targetNodeIds;
  const actionBlockers = options.nodeId
    ? next.blockers.filter((blocker) => blocker.nodeId === options.nodeId
      || (blocker.relatedNodeIds ?? []).includes(options.nodeId))
    : next.blockers;
  const includeIds = associatedIds(graph, selectedNodeIds, actionBlockers);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const now = options.now === undefined ? Date.now() : new Date(options.now).getTime();
  const relevantNodes = [...includeIds].map((id) => byId.get(id)).filter(Boolean)
    .sort((left, right) => codeUnitCompare(left.id, right.id));
  const evidence = relevantNodes.filter((node) => {
    if (node.type !== 'Evidence') return false;
    return freshEvidence(node, byId.get(node.subjectId), now);
  });
  const permissionIds = new Set(relevantNodes.flatMap((node) => node.permissionIds ?? []));
  const relevantPermissions = graph.permissions.filter((permission) =>
    permissionIds.has(permission.id)
    || includeIds.has(permission.resourceRef)
    || permission.resourceRef === '*');
  relevantPermissions.sort((left, right) => codeUnitCompare(left.id, right.id));
  const blockedNodeIds = [...new Set(actionBlockers.map((blocker) => blocker.nodeId).filter(Boolean))]
    .filter((id) => !options.nodeId || includeIds.has(id)).sort(codeUnitCompare);
  const reasonCodes = [...new Set(actionBlockers.map((blocker) => blocker.code))].sort(codeUnitCompare);
  if (reasonCodes.length === 0) reasonCodes.push(`next_action:${next.action}`);
  const refs = relevantNodes.map((node) => node.ref).filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index).sort(codeUnitCompare);
  if (refs.length === 0 && graph.topicRef) refs.push(graph.topicRef);

  return {
    schemaVersion: SCHEMA_VERSION,
    graphId: graph.id,
    graphHash: graphHash(graph),
    owner: next.owner,
    action: next.action,
    selectedNodeIds: [...selectedNodeIds].sort(codeUnitCompare),
    blockedNodeIds,
    reasonCodes,
    refs,
    nodeSummaries: relevantNodes.map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status,
      ...(node.ref ? { ref: node.ref } : {}),
      ...(node.hash ? { hash: node.hash } : {}),
    })),
    evidenceSummaries: evidence.map((node) => ({
      evidenceId: node.id,
      subjectId: node.subjectId,
      summary: node.summary,
      hash: sha256(stableStringify({
        subjectHash: node.subjectHash,
        sourceRevision: node.sourceRevision,
        summary: node.summary,
      })),
    })),
    permissions: relevantPermissions,
  };
}
