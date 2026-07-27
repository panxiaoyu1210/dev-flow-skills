import { WorkflowBlockedError, codeUnitCompare } from './errors.mjs';

export const IMPACT_KINDS = Object.freeze(['requirement', 'artifact', 'file', 'task']);
const externalPattern = /^[a-z][a-z0-9+.-]*:\/\//i;
const globPattern = /[*?{}[\]]/;

export const EDGE_IMPACT_SEMANTICS = Object.freeze({
  implements: 'forward',
  verifies: 'reverse',
  depends_on: 'reverse',
  control: 'forward',
  requires: 'reverse',
  evidences: 'reverse',
  authorizes: 'non_propagating',
  relates_to: 'unmodelled',
  handoff: 'unmodelled',
});

function seedNodes(graph, kind, source) {
  if (kind === 'requirement') {
    return graph.nodes.filter((node) => node.type === 'Requirement' && (node.id === source || node.ref === source));
  }
  if (kind === 'task') {
    return graph.nodes.filter((node) => node.type === 'Task' && (node.id === source || node.ref === source));
  }
  if (kind === 'artifact') {
    return graph.nodes.filter((node) => node.ref === source || node.ref?.split('#')[0] === source);
  }
  return graph.nodes.filter((node) => node.files?.includes(source) || node.ref?.split('#')[0] === source);
}

function propagation(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, new Map()]));
  function add(from, relation) {
    const targets = adjacency.get(from);
    if (!targets) return;
    const previous = targets.get(relation.nodeId);
    const key = `${relation.nodeId}\0${relation.relationType}\0${relation.edgeId}`;
    const previousKey = previous
      ? `${previous.nodeId}\0${previous.relationType}\0${previous.edgeId}`
      : undefined;
    if (!previous || codeUnitCompare(key, previousKey) < 0) targets.set(relation.nodeId, relation);
  }
  for (const edge of graph.edges) {
    const semantics = EDGE_IMPACT_SEMANTICS[edge.type];
    if (semantics === 'forward') {
      add(edge.from, { nodeId: edge.to, relationType: edge.type, edgeId: edge.id });
    } else if (semantics === 'reverse') {
      add(edge.to, { nodeId: edge.from, relationType: edge.type, edgeId: edge.id });
    }
  }
  for (const node of graph.nodes) {
    for (const prerequisiteId of node.prerequisiteIds ?? []) add(prerequisiteId, {
      nodeId: node.id,
      relationType: 'prerequisite',
      edgeId: `prerequisite.${node.id}.${prerequisiteId}`,
    });
  }
  for (const [from, targets] of adjacency) {
    const values = [...targets.values()];
    values.sort((left, right) => codeUnitCompare(
      `${left.nodeId}\0${left.relationType}\0${left.edgeId}`,
      `${right.nodeId}\0${right.relationType}\0${right.edgeId}`,
    ));
    adjacency.set(from, values);
  }
  return adjacency;
}

function classify(graph, impactedNodeIds, unknownImpact) {
  if (unknownImpact) return 'unknown_impact';
  const impacted = new Set(impactedNodeIds);
  if (graph.graphKind === 'loop' && graph.nodes.some(
    (node) => impacted.has(node.id) && ['Goal', 'Baseline'].includes(node.type),
  )) return 'loop_baseline_change';
  if (graph.graphKind === 'master' && graph.nodes.some(
    (node) => impacted.has(node.id) && node.type === 'Requirement',
  )) return 'master_replan';
  return 'within_phase_repair';
}

function routeFor(classification) {
  const routes = {
    within_phase_repair: { owner: 'master', action: 'repair_within_phase' },
    master_replan: { owner: 'master', action: 'replan' },
    loop_baseline_change: { owner: 'loop-controller', action: 'request_baseline_change' },
    unknown_impact: { owner: 'loop-controller', action: 'conservative_review' },
  };
  return routes[classification];
}

export function computeImpact(graph, options) {
  const { kind, source } = options ?? {};
  if (!IMPACT_KINDS.includes(kind)) throw new TypeError(`Unsupported impact kind: ${kind ?? '<missing>'}`);
  if (typeof source !== 'string' || source.length === 0) throw new TypeError('Impact source is required');

  const seeds = seedNodes(graph, kind, source);
  const inherentlyUnknown = globPattern.test(source)
    || externalPattern.test(source)
    || source.startsWith('handoff:');
  let unknownImpact = inherentlyUnknown || seeds.length === 0;
  const visited = new Set(seeds.map((node) => node.id));
  const queue = [...visited].sort(codeUnitCompare);
  const relations = [];
  const adjacency = propagation(graph);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const relation of adjacency.get(current) ?? []) {
      if (visited.has(relation.nodeId)) continue;
      visited.add(relation.nodeId);
      queue.push(relation.nodeId);
      queue.sort(codeUnitCompare);
      relations.push({
        from: current,
        to: relation.nodeId,
        relationType: relation.relationType,
        edgeId: relation.edgeId,
      });
    }
  }
  relations.sort((left, right) => codeUnitCompare(
    `${left.from}\0${left.to}\0${left.relationType}\0${left.edgeId}`,
    `${right.from}\0${right.to}\0${right.relationType}\0${right.edgeId}`,
  ));
  const impactedNodeIds = [...visited].sort(codeUnitCompare);
  const unmodelledEdgeTypes = [...new Set(graph.edges
    .filter((edge) => EDGE_IMPACT_SEMANTICS[edge.type] === 'unmodelled'
      && (visited.has(edge.from) || visited.has(edge.to)))
    .map((edge) => edge.type))].sort(codeUnitCompare);
  if (unmodelledEdgeTypes.length > 0) unknownImpact = true;
  const classification = classify(graph, impactedNodeIds, unknownImpact);
  return {
    kind,
    source,
    seedNodeIds: seeds.map((node) => node.id).sort(codeUnitCompare),
    impactedNodeIds,
    relations,
    unknownImpact,
    classification,
    route: routeFor(classification),
    reasonCodes: unknownImpact
      ? ['unmodelled_dependency', ...unmodelledEdgeTypes.map((type) => `unmodelled_edge:${type}`)]
      : [],
  };
}

export function applyImpact(graph, options) {
  if (!graph.authority?.graphMutationAllowed || graph.authority?.mode !== 'graph') {
    throw new WorkflowBlockedError('AUTHORITY_READ_ONLY', [{
      code: 'authority_read_only',
      rule: 'authority.single_writer',
      path: '/authority/mode',
      nodeIds: [],
      message: `${graph.authority?.mode ?? 'legacy'} authority does not permit Graph mutation`,
    }]);
  }
  const result = computeImpact(graph, options);
  if (result.unknownImpact) return { ...result, applied: false, graph: structuredClone(graph) };
  const nextGraph = structuredClone(graph);
  const impacted = new Set(result.impactedNodeIds);
  for (const node of nextGraph.nodes) {
    if (impacted.has(node.id)) node.status = 'stale';
  }
  nextGraph.revision += 1;
  return { ...result, applied: true, graph: nextGraph };
}
