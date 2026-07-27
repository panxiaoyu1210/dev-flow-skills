import { codeUnitCompare } from './errors.mjs';

function nodeMap(graph) {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

export function directPrerequisiteIds(graph, nodeId) {
  const byId = nodeMap(graph);
  const node = byId.get(nodeId);
  const ids = new Set(node?.prerequisiteIds ?? []);
  for (const edge of graph.edges) {
    if (edge.type === 'depends_on' && edge.from === nodeId) ids.add(edge.to);
    if (edge.type === 'control' && edge.to === nodeId) ids.add(edge.from);
  }
  return [...ids].filter((id) => byId.has(id)).sort(codeUnitCompare);
}

export function prerequisiteClosure(graph, nodeId) {
  const closure = new Set();
  const queue = directPrerequisiteIds(graph, nodeId);
  while (queue.length > 0) {
    const current = queue.shift();
    if (closure.has(current)) continue;
    closure.add(current);
    for (const prerequisiteId of directPrerequisiteIds(graph, current)) {
      if (!closure.has(prerequisiteId)) queue.push(prerequisiteId);
    }
    queue.sort(codeUnitCompare);
  }
  return [...closure].sort(codeUnitCompare);
}

export function gateDependsOnTask(graph, gateId, taskId) {
  return prerequisiteClosure(graph, gateId).includes(taskId);
}

export function relatedGateIds(graph, subjectIds) {
  const byId = nodeMap(graph);
  const targets = new Set(subjectIds);
  const ids = new Set();
  for (const subjectId of targets) {
    for (const relatedId of byId.get(subjectId)?.relatedNodeIds ?? []) {
      if (byId.get(relatedId)?.type === 'Gate') ids.add(relatedId);
    }
  }
  for (const gate of graph.nodes.filter((node) => node.type === 'Gate')) {
    if ((gate.relatedNodeIds ?? []).some((id) => targets.has(id))) ids.add(gate.id);
  }
  for (const edge of graph.edges) {
    if (edge.type === 'requires' && targets.has(edge.from) && byId.get(edge.to)?.type === 'Gate') ids.add(edge.to);
  }
  return [...ids].sort(codeUnitCompare);
}

export function taskGovernedGateIds(graph, taskId) {
  const requirementIds = graph.edges
    .filter((edge) => edge.type === 'implements' && edge.to === taskId)
    .map((edge) => edge.from)
    .sort(codeUnitCompare);
  return relatedGateIds(graph, [taskId, ...requirementIds]);
}

export function relatedEvalIds(graph, phaseId) {
  const byId = nodeMap(graph);
  const phase = byId.get(phaseId);
  const ids = new Set((phase?.relatedNodeIds ?? []).filter((id) => byId.get(id)?.type === 'Eval'));
  for (const evaluation of graph.nodes.filter((node) => node.type === 'Eval')) {
    if ((evaluation.relatedNodeIds ?? []).includes(phaseId)) ids.add(evaluation.id);
  }
  for (const edge of graph.edges) {
    if (edge.from === phaseId && byId.get(edge.to)?.type === 'Eval') ids.add(edge.to);
    if (edge.to === phaseId && byId.get(edge.from)?.type === 'Eval') ids.add(edge.from);
  }
  return [...ids].sort(codeUnitCompare);
}

function relatedPhaseIdsByRelatedIds(graph, nodeId) {
  const byId = nodeMap(graph);
  const node = byId.get(nodeId);
  const ids = new Set((node?.relatedNodeIds ?? []).filter((id) => byId.get(id)?.type === 'Phase'));
  for (const phase of graph.nodes.filter((item) => item.type === 'Phase')) {
    if ((phase.relatedNodeIds ?? []).includes(nodeId)) ids.add(phase.id);
  }
  return [...ids].sort(codeUnitCompare);
}

export function resolvePhaseEvalRelation(graph, phaseId) {
  const byId = nodeMap(graph);
  const phase = byId.get(phaseId);
  const evalIds = new Set((phase?.relatedNodeIds ?? []).filter((id) => byId.get(id)?.type === 'Eval'));
  for (const evaluation of graph.nodes.filter((node) => node.type === 'Eval')) {
    if ((evaluation.relatedNodeIds ?? []).includes(phaseId)) evalIds.add(evaluation.id);
  }
  const stableEvalIds = [...evalIds].sort(codeUnitCompare);
  if (stableEvalIds.length === 0) return {
    status: 'missing', phaseId, evalIds: [], phaseIds: [phaseId],
  };
  if (stableEvalIds.length > 1) return {
    status: 'ambiguous', phaseId, evalIds: stableEvalIds, phaseIds: [phaseId],
  };
  const evalId = stableEvalIds[0];
  const phaseIds = relatedPhaseIdsByRelatedIds(graph, evalId);
  if (phaseIds.length > 1) return {
    status: 'shared', phaseId, evalId, evalIds: [evalId], phaseIds,
  };
  return {
    status: 'resolved', phaseId, evalId, evalIds: [evalId], phaseIds: [phaseId],
  };
}

const usableControlStatuses = Object.freeze({
  Goal: new Set(['active']),
  Baseline: new Set(['passed', 'approved', 'user_confirmed']),
  Envelope: new Set(['passed', 'approved']),
  Budget: new Set(['active', 'available']),
});

function phaseRelatedControlIds(graph, phaseId, type) {
  const byId = nodeMap(graph);
  const phase = byId.get(phaseId);
  const ids = new Set((phase?.relatedNodeIds ?? []).filter((id) => byId.get(id)?.type === type));
  for (const candidate of graph.nodes.filter((node) => node.type === type)) {
    if ((candidate.relatedNodeIds ?? []).includes(phaseId)) ids.add(candidate.id);
  }
  for (const edge of graph.edges) {
    if (edge.from === phaseId && byId.get(edge.to)?.type === type) ids.add(edge.to);
    if (edge.to === phaseId && byId.get(edge.from)?.type === type) ids.add(edge.from);
  }
  return [...ids].sort(codeUnitCompare);
}

export function resolvePhaseControl(graph, phaseId, type, allowedStatuses = usableControlStatuses[type]) {
  const candidates = graph.nodes.filter((node) => node.type === type)
    .sort((left, right) => codeUnitCompare(left.id, right.id));
  const explicitIds = phaseRelatedControlIds(graph, phaseId, type);
  const explicit = candidates.filter((node) => explicitIds.includes(node.id));
  if (explicit.length > 0) {
    const usable = explicit.filter((node) => allowedStatuses.has(node.status));
    if (usable.length === 1) return { status: 'resolved', type, nodeId: usable[0].id, candidateIds: explicitIds };
    return {
      status: usable.length === 0 ? 'unavailable' : 'ambiguous',
      type,
      candidateIds: explicitIds,
    };
  }
  const phases = graph.nodes.filter((node) => node.type === 'Phase');
  const globalCandidates = candidates.filter((node) => phases.every((phase) => phase.id === phaseId
    || !phaseRelatedControlIds(graph, phase.id, type).includes(node.id)));
  const globallyUsable = globalCandidates.filter((node) => allowedStatuses.has(node.status));
  if (globallyUsable.length === 1) return {
    status: 'resolved', type, nodeId: globallyUsable[0].id, candidateIds: [globallyUsable[0].id],
  };
  return {
    status: globalCandidates.length === 0
      ? 'missing' : globallyUsable.length === 0 ? 'unavailable' : 'ambiguous',
    type,
    candidateIds: (globallyUsable.length > 0 ? globallyUsable : globalCandidates).map((node) => node.id),
  };
}

export function resolvePhaseCoordinates(graph, phaseId, options = {}) {
  const goalStatuses = new Set(options.goalStatuses ?? ['active']);
  const resolutions = {
    Goal: resolvePhaseControl(graph, phaseId, 'Goal', goalStatuses),
    Baseline: resolvePhaseControl(graph, phaseId, 'Baseline'),
    Envelope: resolvePhaseControl(graph, phaseId, 'Envelope'),
    Budget: resolvePhaseControl(graph, phaseId, 'Budget'),
  };
  const evaluation = resolvePhaseEvalRelation(graph, phaseId);
  const issues = [];
  for (const resolution of Object.values(resolutions)) {
    if (resolution.status === 'resolved') continue;
    issues.push({
      code: `${resolution.status}_${resolution.type.toLowerCase()}_control`,
      phaseId,
      candidateIds: resolution.candidateIds,
    });
  }
  if (evaluation.status !== 'resolved') issues.push({
    code: evaluation.status === 'missing'
      ? 'phase_eval_relation_missing'
      : evaluation.status === 'shared' ? 'phase_eval_relation_shared' : 'phase_eval_relation_ambiguous',
    phaseId,
    candidateIds: evaluation.evalIds,
    phaseIds: evaluation.phaseIds,
  });
  return {
    phaseId,
    issues: issues.sort((left, right) => codeUnitCompare(
      `${left.code}\0${left.phaseId}`,
      `${right.code}\0${right.phaseId}`,
    )),
    controls: issues.length === 0 ? {
      goalId: resolutions.Goal.nodeId,
      baselineId: resolutions.Baseline.nodeId,
      envelopeId: resolutions.Envelope.nodeId,
      budgetId: resolutions.Budget.nodeId,
      evalId: evaluation.evalId,
    } : undefined,
    resolutions,
    evaluation,
  };
}

function phaseFrontier(graph, phases) {
  const ids = new Set(phases.map((phase) => phase.id));
  const prerequisiteOfAnother = new Set();
  for (const phase of phases) {
    for (const prerequisiteId of prerequisiteClosure(graph, phase.id)) {
      if (ids.has(prerequisiteId)) prerequisiteOfAnother.add(prerequisiteId);
    }
  }
  const frontier = phases.filter((phase) => !prerequisiteOfAnother.has(phase.id));
  return (frontier.length > 0 ? frontier : phases)
    .sort((left, right) => codeUnitCompare(left.id, right.id));
}

const satisfiedDependencyStatuses = new Set([
  'passed', 'approved', 'user_confirmed', 'complete', 'resolved',
]);

export function phaseDependenciesSatisfied(graph, phaseId) {
  const byId = nodeMap(graph);
  return directPrerequisiteIds(graph, phaseId)
    .every((id) => satisfiedDependencyStatuses.has(byId.get(id)?.status));
}

export function resolveCurrentPhase(graph, options = {}) {
  const allowedPhaseIds = options.phaseIds ? new Set(options.phaseIds) : undefined;
  const phases = graph.nodes.filter((node) => node.type === 'Phase'
    && (!allowedPhaseIds || allowedPhaseIds.has(node.id)));
  const active = phaseFrontier(graph, phases.filter((phase) => phase.status === 'active'));
  if (active.length > 0) return {
    status: active.length === 1 ? 'resolved' : 'selected',
    phaseId: active[0].id,
    candidateIds: active.map((phase) => phase.id),
  };
  const eligibleReady = phases.filter((phase) => phase.status === 'ready'
      && phaseDependenciesSatisfied(graph, phase.id))
    .sort((left, right) => codeUnitCompare(left.id, right.id));
  if (eligibleReady.length > 0) return {
    status: eligibleReady.length === 1 ? 'resolved' : 'selected',
    phaseId: eligibleReady[0].id,
    candidateIds: eligibleReady.map((phase) => phase.id),
  };
  const fallbackGroups = [
    phases.filter((phase) => phase.status === 'ready'),
    phases.filter((phase) => ['pending', 'blocked', 'failed', 'stale'].includes(phase.status)),
    phases.filter((phase) => phase.status === 'complete'),
    phases.filter((phase) => phase.status === 'stopped'),
  ];
  for (const group of fallbackGroups) {
    const candidates = phaseFrontier(graph, group);
    if (candidates.length > 0) return {
      status: candidates.length === 1 ? 'resolved' : 'selected',
      phaseId: candidates[0].id,
      candidateIds: candidates.map((phase) => phase.id),
    };
  }
  return { status: 'missing', candidateIds: [] };
}

function selectGoalByActivePhase(graph, goals) {
  const withActivePhase = goals.filter((goal) => {
    const domain = resolveGoalDomain(graph, goal.id, { goalStatuses: [goal.status] });
    return domain.status === 'resolved'
      && domain.phases.some(({ phase }) => phase.status === 'active');
  });
  return withActivePhase.length === 1 ? withActivePhase[0] : undefined;
}

export function resolveCurrentGoal(graph) {
  const goals = graph.nodes.filter((node) => node.type === 'Goal')
    .sort((left, right) => codeUnitCompare(left.id, right.id));
  if (goals.length === 0) return { status: 'missing', candidateIds: [] };

  for (const statuses of [['active'], ['stale', 'blocked'], ['pending']]) {
    const candidates = goals.filter((goal) => statuses.includes(goal.status));
    if (candidates.length === 1) return {
      status: 'resolved', goalId: candidates[0].id, candidateIds: [candidates[0].id],
    };
    if (candidates.length > 1) {
      const selected = selectGoalByActivePhase(graph, candidates);
      if (selected) return {
        status: 'resolved', goalId: selected.id, candidateIds: candidates.map((goal) => goal.id),
      };
      return {
        status: 'ambiguous', candidateIds: candidates.map((goal) => goal.id),
      };
    }
  }

  const terminalCandidates = goals.filter((goal) => ['complete', 'stopped'].includes(goal.status));
  if (terminalCandidates.length === 1) return {
    status: 'resolved', goalId: terminalCandidates[0].id, candidateIds: [terminalCandidates[0].id],
  };
  if (terminalCandidates.length > 1) {
    const currentPhase = resolveCurrentPhase(graph);
    const matching = terminalCandidates.filter((goal) => {
      const domain = resolveGoalDomain(graph, goal.id, { goalStatuses: [goal.status] });
      return domain.status === 'resolved' && domain.phaseIds.includes(currentPhase.phaseId);
    });
    if (matching.length === 1) return {
      status: 'resolved', goalId: matching[0].id,
      candidateIds: terminalCandidates.map((goal) => goal.id),
    };
    return {
      status: 'ambiguous', candidateIds: terminalCandidates.map((goal) => goal.id),
    };
  }
  return { status: 'missing', candidateIds: goals.map((goal) => goal.id) };
}

export function resolveGoalPhaseIds(graph, goalId, allowedStatuses) {
  const goal = nodeMap(graph).get(goalId);
  const domain = resolveGoalDomain(graph, goalId, {
    goalStatuses: allowedStatuses ?? (goal ? [goal.status] : []),
  });
  return domain.status === 'resolved' ? domain.phaseIds : [];
}

export function resolveGoalDomain(graph, goalId, options = {}) {
  const byId = nodeMap(graph);
  const goal = byId.get(goalId);
  const goals = graph.nodes.filter((node) => node.type === 'Goal');
  const phases = graph.nodes.filter((node) => node.type === 'Phase');
  if (!goal || goal.type !== 'Goal') return {
    status: 'missing', goalId, phaseIds: [], nodeIds: [], phases: [],
  };
  const explicitPhaseIds = phases
    .filter((phase) => phaseRelatedControlIds(graph, phase.id, 'Goal').includes(goalId))
    .map((phase) => phase.id)
    .sort(codeUnitCompare);
  const phaseIds = goals.length === 1
    ? phases.map((phase) => phase.id).sort(codeUnitCompare)
    : explicitPhaseIds;
  if (phaseIds.length === 0) return {
    status: 'ambiguous', goalId, phaseIds: [], nodeIds: [goalId], phases: [],
    candidateGoalIds: goals.map((node) => node.id).sort(codeUnitCompare),
  };

  const goalStatuses = options.goalStatuses ?? [goal.status];
  const phaseBindings = phaseIds.map((phaseId) => ({
    phase: byId.get(phaseId),
    coordinates: resolvePhaseCoordinates(graph, phaseId, { goalStatuses }),
  }));
  const nodeIds = new Set([goalId, ...phaseIds]);
  for (const binding of phaseBindings) {
    const { coordinates } = binding;
    for (const resolution of Object.values(coordinates.resolutions)) {
      if (resolution.nodeId) nodeIds.add(resolution.nodeId);
      for (const candidateId of resolution.candidateIds ?? []) nodeIds.add(candidateId);
    }
    if (coordinates.evaluation.evalId) nodeIds.add(coordinates.evaluation.evalId);
    for (const evalId of coordinates.evaluation.evalIds ?? []) nodeIds.add(evalId);
  }
  return {
    status: 'resolved',
    goalId,
    phaseIds,
    nodeIds: [...nodeIds].sort(codeUnitCompare),
    phases: phaseBindings,
  };
}

function relationIssue(relation) {
  return {
    code: relation.status === 'missing'
      ? 'phase_eval_relation_missing'
      : relation.status === 'shared' ? 'phase_eval_relation_shared' : 'phase_eval_relation_ambiguous',
    nodeId: relation.status === 'shared' ? relation.evalId : relation.phaseId,
    relatedNodeIds: [...new Set([
      relation.phaseId,
      ...(relation.evalIds ?? []),
      ...(relation.phaseIds ?? []),
    ])].filter((id) => id !== (relation.status === 'shared' ? relation.evalId : relation.phaseId))
      .sort(codeUnitCompare),
  };
}

export function evaluateGoalCompletion(graph, goalId, options = {}) {
  const domain = resolveGoalDomain(graph, goalId, options);
  if (domain.status !== 'resolved') return {
    ...domain,
    ready: false,
    stopped: false,
    issues: [{
      code: `goal_domain_${domain.status}`,
      nodeId: goalId,
      relatedNodeIds: domain.candidateGoalIds ?? [],
    }],
  };
  const byId = nodeMap(graph);
  const issues = [];
  for (const { phase, coordinates } of domain.phases) {
    if (phase.status === 'stopped') issues.push({
      code: 'phase_stopped', nodeId: phase.id, relatedNodeIds: [goalId],
    });
    else if (phase.status !== 'complete') issues.push({
      code: 'phase_incomplete', nodeId: phase.id, relatedNodeIds: [goalId],
    });

    if (coordinates.evaluation.status !== 'resolved') {
      issues.push(relationIssue(coordinates.evaluation));
    } else {
      const evaluation = byId.get(coordinates.evaluation.evalId);
      if (evaluation?.status !== 'passed') issues.push({
        code: `eval_${evaluation?.status ?? 'missing'}`,
        nodeId: evaluation?.id ?? phase.id,
        relatedNodeIds: [phase.id],
      });
    }
    for (const issue of coordinates.issues.filter((item) => !item.code.startsWith('phase_eval_relation_'))) {
      issues.push({
        code: issue.code,
        nodeId: phase.id,
        relatedNodeIds: [...new Set(issue.candidateIds ?? [])].sort(codeUnitCompare),
      });
    }
  }
  const stableIssues = [...new Map(issues.map((issue) => [
    `${issue.code}\0${issue.nodeId}\0${issue.relatedNodeIds.join('\0')}`,
    issue,
  ])).entries()].sort((left, right) => codeUnitCompare(left[0], right[0])).map((entry) => entry[1]);
  return {
    ...domain,
    ready: stableIssues.length === 0,
    stopped: stableIssues.some((issue) => issue.code === 'phase_stopped'),
    issues: stableIssues,
  };
}
