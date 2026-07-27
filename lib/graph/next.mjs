import { codeUnitCompare } from './errors.mjs';
import {
  directPrerequisiteIds,
  evaluateGoalCompletion,
  gateDependsOnTask,
  resolveCurrentGoal,
  resolveCurrentPhase,
  resolveGoalDomain,
  resolvePhaseCoordinates,
  resolvePhaseEvalRelation,
  taskGovernedGateIds,
} from './relations.mjs';

const satisfiedStatuses = new Set(['passed', 'approved', 'user_confirmed', 'complete', 'resolved']);
const runnableTaskStatuses = new Set(['pending', 'planned', 'ready']);

function sortedNodes(graph, type) {
  return graph.nodes.filter((node) => node.type === type)
    .sort((left, right) => codeUnitCompare(left.id, right.id));
}

function referencesFor(graph, ids) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const refs = new Set();
  for (const id of ids) {
    const node = byId.get(id);
    if (node?.ref) refs.add(node.ref);
    if (node?.type === 'Evidence' && byId.get(node.subjectId)?.ref) refs.add(byId.get(node.subjectId).ref);
  }
  return [...refs].sort(codeUnitCompare);
}

function blocker(graph, code, nodeId, relatedNodeIds = [], legacyReason = code) {
  const stableRelated = [...new Set(relatedNodeIds)].sort(codeUnitCompare);
  return {
    code,
    ...(nodeId ? { nodeId } : {}),
    relatedNodeIds: stableRelated,
    refs: referencesFor(graph, [nodeId, ...stableRelated].filter(Boolean)),
    legacyReason,
  };
}

function blockerKey(item) {
  return `${item.code}\0${item.nodeId ?? ''}\0${item.relatedNodeIds.join('\0')}\0${item.refs.join('\0')}`;
}

function stableBlockers(items) {
  const unique = new Map();
  for (const item of items) unique.set(blockerKey(item), item);
  return [...unique.values()].sort((left, right) => codeUnitCompare(blockerKey(left), blockerKey(right)));
}

function publicBlockers(items) {
  return stableBlockers(items).map(({ legacyReason, ...item }) => item);
}

function legacyReasons(items) {
  return [...new Set(stableBlockers(items).map((item) => item.legacyReason))].sort(codeUnitCompare);
}

function prerequisiteBlockers(node, graph) {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const items = [];
  for (const prerequisiteId of node.prerequisiteIds ?? []) {
    if (satisfiedStatuses.has(byId.get(prerequisiteId)?.status)) continue;
    items.push(blocker(
      graph, 'prerequisite_not_satisfied', node.id, [prerequisiteId],
      `prerequisite_not_satisfied:${prerequisiteId}`,
    ));
  }
  for (const edge of graph.edges) {
    if (edge.type === 'depends_on' && edge.from === node.id
      && !satisfiedStatuses.has(byId.get(edge.to)?.status)) items.push(blocker(
      graph, 'dependency_not_satisfied', node.id, [edge.to],
      `dependency_not_satisfied:${edge.to}`,
    ));
    if (edge.type === 'control' && edge.to === node.id
      && !satisfiedStatuses.has(byId.get(edge.from)?.status)) items.push(blocker(
      graph, 'control_not_satisfied', node.id, [edge.from],
      `control_not_satisfied:${edge.from}`,
    ));
  }
  return stableBlockers(items);
}

function uniqueTargets(ids) {
  return [...new Set(ids.filter(Boolean))].sort(codeUnitCompare);
}

function baseResult(graphKind, owner, action, targetNodeIds, blockers, extra = {}) {
  return {
    graphKind,
    owner,
    action,
    targetNodeIds: uniqueTargets(targetNodeIds),
    blockers: publicBlockers(blockers),
    ...extra,
    blocked: false,
  };
}

function masterNext(graph) {
  if (graph.nodes.length === 0) return baseResult(
    'master', 'master', 'define_requirement', [],
    [blocker(graph, 'requirement_scope_missing', undefined, [])],
    { eligibleTasks: [], blockedTasks: [], eligiblePhases: [], blockedPhases: [] },
  );

  const requirements = sortedNodes(graph, 'Requirement');
  if (requirements.length === 0) return baseResult(
    'master', 'master', 'define_requirement', graph.nodes.map((node) => node.id),
    [blocker(graph, 'requirement_scope_missing', undefined, graph.nodes.map((node) => node.id))],
    { eligibleTasks: [], blockedTasks: [], eligiblePhases: [], blockedPhases: [] },
  );

  const failures = sortedNodes(graph, 'Failure').filter((node) => !['resolved', 'complete'].includes(node.status));
  const staleGit = sortedNodes(graph, 'Git').filter((node) => node.status === 'stale');
  const gates = sortedNodes(graph, 'Gate');
  const actionableGates = [];
  const blockedGateDetails = [];
  for (const gate of gates.filter((node) => node.status !== 'passed')) {
    const items = prerequisiteBlockers(gate, graph);
    if (gate.status !== 'pending') items.push(blocker(
      graph, `gate_status_${gate.status}`, gate.id, [], `gate_status:${gate.status}`,
    ));
    const stable = stableBlockers(items);
    if (stable.length === 0) actionableGates.push(gate);
    else blockedGateDetails.push({ node: gate, blockers: stable });
  }

  const eligibleTasks = [];
  const blockedTaskDetails = [];
  const activeTasks = [];
  for (const task of sortedNodes(graph, 'Task').filter((node) => node.status !== 'complete')) {
    const items = [];
    if (!runnableTaskStatuses.has(task.status) && task.status !== 'in_progress') items.push(blocker(
      graph, `task_status_${task.status}`, task.id, [], `task_status:${task.status}`,
    ));
    items.push(...prerequisiteBlockers(task, graph));
    for (const failure of failures) items.push(blocker(
      graph, 'active_failure', task.id, [failure.id], `active_failure:${failure.id}`,
    ));
    for (const gateId of taskGovernedGateIds(graph, task.id)) {
      const gate = graph.nodes.find((node) => node.id === gateId);
      if (gate?.status === 'passed' || gateDependsOnTask(graph, gateId, task.id)) continue;
      items.push(blocker(graph, 'gate_not_passed', task.id, [gateId], `gate_not_passed:${gateId}`));
    }
    const stable = stableBlockers(items);
    if (stable.length === 0 && task.status === 'in_progress') activeTasks.push(task.id);
    else if (stable.length === 0) eligibleTasks.push(task.id);
    else blockedTaskDetails.push({ node: task, blockers: stable });
  }

  const blockedTasks = blockedTaskDetails.map(({ node, blockers }) => ({
    nodeId: node.id, reasons: legacyReasons(blockers),
  }));
  const blockedGates = blockedGateDetails.map(({ node, blockers }) => ({
    nodeId: node.id, reasons: legacyReasons(blockers),
  }));
  const extra = {
    eligibleTasks,
    blockedTasks,
    activeTasks,
    eligibleGates: actionableGates.map((gate) => gate.id),
    blockedGates,
    eligiblePhases: [],
    blockedPhases: [],
  };

  if (failures.length > 0) return baseResult(
    'master', failures[0].owner ?? 'master', 'resolve_failure', [failures[0].id],
    [blocker(graph, 'active_failure', failures[0].id)], extra,
  );
  if (staleGit.length > 0) return baseResult(
    'master', staleGit[0].owner ?? 'git', 'repair_git_state', [staleGit[0].id],
    [blocker(graph, 'git_state_stale', staleGit[0].id)], extra,
  );
  if (actionableGates.length > 0) return baseResult(
    'master', actionableGates[0].owner ?? 'checker', 'evaluate_gate', [actionableGates[0].id], [], extra,
  );
  if (activeTasks.length > 0) {
    const task = graph.nodes.find((node) => node.id === activeTasks[0]);
    return baseResult('master', task?.owner ?? 'implementation', 'continue_task', [task.id], [], extra);
  }
  if (eligibleTasks.length > 0) {
    const task = graph.nodes.find((node) => node.id === eligibleTasks[0]);
    return baseResult('master', task?.owner ?? 'implementation', 'execute_task', [task.id], [], extra);
  }
  if (blockedGateDetails.length > 0) {
    const detail = blockedGateDetails[0];
    return baseResult(
      'master', detail.node.owner ?? 'master', 'repair_gate_prerequisites',
      [detail.node.id], detail.blockers, extra,
    );
  }
  if (blockedTaskDetails.length > 0) {
    const detail = blockedTaskDetails[0];
    return baseResult('master', 'master', 'replan_blocked_tasks', [detail.node.id], detail.blockers, extra);
  }

  const acceptanceRepairs = [
    [sortedNodes(graph, 'Test').filter((node) => !['passed', 'complete'].includes(node.status)), 'test', 'run_test', 'test_not_ready'],
    [sortedNodes(graph, 'Requirement').filter((node) => node.status !== 'complete'), 'master', 'complete_requirement', 'requirement_not_complete'],
    [sortedNodes(graph, 'Evidence').filter((node) => node.status !== 'passed'), 'checker', 'refresh_evidence', 'evidence_not_ready'],
    [sortedNodes(graph, 'Git').filter((node) => node.status !== 'complete'), 'git', 'complete_git', 'git_not_complete'],
  ];
  const repair = acceptanceRepairs.find(([nodes]) => nodes.length > 0);
  if (repair) {
    const [nodes, defaultOwner, action, code] = repair;
    return baseResult(
      'master', nodes[0].owner ?? defaultOwner, action, [nodes[0].id],
      [blocker(graph, code, nodes[0].id)], extra,
    );
  }
  return baseResult(
    'master', 'acceptance', 'collect_acceptance', graph.nodes.map((node) => node.id), [], extra,
  );
}

function relationIssueBlocker(graph, relation) {
  const code = relation.status === 'missing'
    ? 'phase_eval_relation_missing'
    : relation.status === 'shared' ? 'phase_eval_relation_shared' : 'phase_eval_relation_ambiguous';
  const nodeId = relation.status === 'shared' ? relation.evalId : relation.phaseId;
  return blocker(
    graph,
    code,
    nodeId,
    uniqueTargets([relation.phaseId, ...(relation.evalIds ?? []), ...(relation.phaseIds ?? [])]
      .filter((id) => id !== nodeId)),
  );
}

function coordinateIssueBlocker(graph, issue) {
  const nodeId = issue.phaseId;
  const exhaustedBudget = issue.code === 'unavailable_budget_control'
    ? (issue.candidateIds ?? [])
      .map((id) => graph.nodes.find((node) => node.id === id))
      .find((node) => node && ['exhausted', 'stopped'].includes(node.status))
    : undefined;
  return blocker(
    graph,
    issue.code,
    nodeId,
    uniqueTargets([...(issue.candidateIds ?? []), ...(issue.phaseIds ?? [])].filter((id) => id !== nodeId)),
    exhaustedBudget ? `budget_exhausted:${exhaustedBudget.id}` : issue.code,
  );
}

function goalIssueBlocker(graph, issue) {
  const node = graph.nodes.find((item) => item.id === issue.nodeId);
  const legacyReason = issue.code === 'phase_stopped'
    ? `phase_status:stopped`
    : issue.code === 'phase_incomplete'
      ? `phase_status:${node?.status ?? 'missing'}`
      : issue.code.startsWith('eval_')
        ? `eval_status:${node?.status ?? issue.code.slice('eval_'.length)}`
        : issue.code;
  return blocker(graph, issue.code, issue.nodeId, issue.relatedNodeIds ?? [], legacyReason);
}

function goalIssuePriority(issue) {
  if (issue.code.startsWith('phase_eval_relation_')) return 0;
  if (issue.code.startsWith('eval_')) return 1;
  if (issue.code.includes('_goal_control')) return 2;
  if (issue.code.includes('_baseline_control')) return 3;
  if (issue.code.includes('_envelope_control')) return 4;
  if (issue.code.includes('_budget_control')) return 5;
  return 6;
}

function resolvedNode(graph, resolution) {
  return resolution?.status === 'resolved'
    ? graph.nodes.find((node) => node.id === resolution.nodeId)
    : undefined;
}

function uniqueCandidateNode(graph, resolution) {
  return resolution?.candidateIds?.length === 1
    ? graph.nodes.find((node) => node.id === resolution.candidateIds[0])
    : undefined;
}

function loopNext(graph) {
  if (graph.nodes.length === 0) return baseResult(
    'loop', 'loop-controller', 'establish_goal_baseline', [],
    [
      blocker(graph, 'missing_goal_control', undefined, []),
      blocker(graph, 'missing_baseline_control', undefined, []),
    ],
    { eligibleTasks: [], blockedTasks: [], eligiblePhases: [], blockedPhases: [] },
  );

  const allPhases = sortedNodes(graph, 'Phase');
  const evals = sortedNodes(graph, 'Eval');
  const emptyExtra = {
    eligibleTasks: [], blockedTasks: [], eligiblePhases: [], blockedPhases: [],
    activePhases: [], eligibleEvals: [], blockedEvals: [],
  };

  const goalSelection = resolveCurrentGoal(graph);
  if (goalSelection.status === 'missing') return baseResult(
    'loop', 'loop-controller', 'repair_loop_controls', goalSelection.candidateIds,
    [blocker(graph, 'missing_goal_control', undefined, goalSelection.candidateIds)], emptyExtra,
  );
  if (goalSelection.status === 'ambiguous') return baseResult(
    'loop', 'loop-controller', 'resolve_current_goal', goalSelection.candidateIds,
    [blocker(graph, 'ambiguous_current_goal', undefined, goalSelection.candidateIds)], emptyExtra,
  );
  const currentGoal = graph.nodes.find((node) => node.id === goalSelection.goalId);
  const currentDomain = resolveGoalDomain(graph, currentGoal.id, { goalStatuses: [currentGoal.status] });
  if (currentDomain.status !== 'resolved') return baseResult(
    'loop', 'loop-controller', 'resolve_current_goal', goalSelection.candidateIds,
    [blocker(graph, `current_goal_domain_${currentDomain.status}`, currentGoal.id, goalSelection.candidateIds)],
    emptyExtra,
  );
  const phaseIds = new Set(currentDomain.phaseIds);
  const phases = allPhases.filter((phase) => phaseIds.has(phase.id));
  const phaseSelection = resolveCurrentPhase(graph, { phaseIds: currentDomain.phaseIds });
  if (phaseSelection.status === 'missing') return baseResult(
    'loop', 'loop-controller', 'repair_phase_plan', [],
    [blocker(graph, 'phase_scope_incomplete', undefined, [])], emptyExtra,
  );
  const selectedPhase = graph.nodes.find((node) => node.id === phaseSelection.phaseId);
  const selectedCoordinates = resolvePhaseCoordinates(graph, selectedPhase.id);
  const selectedEvaluation = selectedCoordinates.evaluation.status === 'resolved'
    ? graph.nodes.find((node) => node.id === selectedCoordinates.evaluation.evalId)
    : undefined;

  const openPhases = phases.filter((node) => !['complete', 'stopped'].includes(node.status));
  const phaseDetails = [];
  for (const phase of openPhases) {
    const coordinates = resolvePhaseCoordinates(graph, phase.id);
    const items = [];
    for (const issue of coordinates.issues) items.push(coordinateIssueBlocker(graph, issue));
    const evaluation = coordinates.controls
      ? graph.nodes.find((node) => node.id === coordinates.controls.evalId)
      : undefined;
    if (evaluation && evaluation.status !== 'passed') items.push(blocker(
      graph, `eval_${evaluation.status}`, evaluation.id, [phase.id], `eval_status:${evaluation.status}`,
    ));
    if (!['ready', 'active'].includes(phase.status)) items.push(blocker(
      graph, `phase_status_${phase.status}`, phase.id, [], `phase_status:${phase.status}`,
    ));
    items.push(...prerequisiteBlockers(phase, graph));
    phaseDetails.push({ phase, coordinates, evaluation, blockers: stableBlockers(items) });
  }

  const eligiblePhases = phaseDetails.filter((detail) => detail.blockers.length === 0 && detail.phase.status === 'ready')
    .map((detail) => detail.phase.id);
  const activePhases = phaseDetails.filter((detail) => detail.blockers.length === 0 && detail.phase.status === 'active')
    .map((detail) => detail.phase.id);
  const blockedPhaseDetails = phaseDetails.filter((detail) => detail.blockers.length > 0);
  const blockedPhases = blockedPhaseDetails.map((detail) => ({
    nodeId: detail.phase.id, reasons: legacyReasons(detail.blockers),
  }));
  const eligibleEvals = selectedEvaluation && ['pending', 'ready', 'active'].includes(selectedEvaluation.status)
    ? [selectedEvaluation] : [];
  const blockedEvals = evals.filter((node) => node.id === selectedEvaluation?.id
      && ['stale', 'failed', 'blocked', 'stopped'].includes(node.status))
    .map((node) => ({ nodeId: node.id, reasons: [`eval_status:${node.status}`] }));
  const extra = {
    eligibleTasks: [], blockedTasks: [], eligiblePhases, blockedPhases, activePhases,
    eligibleEvals: eligibleEvals.map((node) => node.id), blockedEvals,
  };

  const budgetResolution = selectedCoordinates.resolutions.Budget;
  const selectedBudget = resolvedNode(graph, budgetResolution) ?? uniqueCandidateNode(graph, budgetResolution);
  if (selectedBudget && ['exhausted', 'stopped'].includes(selectedBudget.status)) return baseResult(
    'loop', 'loop-controller', 'stop_budget_exhausted', [selectedBudget.id],
    [blocker(graph, 'budget_exhausted', selectedBudget.id)], extra,
  );

  const goalResolution = selectedCoordinates.resolutions.Goal;
  const selectedGoal = resolvedNode(graph, goalResolution) ?? uniqueCandidateNode(graph, goalResolution);
  const goalCompletion = selectedGoal
    ? evaluateGoalCompletion(graph, selectedGoal.id, { goalStatuses: [selectedGoal.status] })
    : undefined;
  const goalTargetNodeIds = goalCompletion?.nodeIds ?? [];
  const goalBlockers = (goalCompletion?.issues ?? []).map((issue) => goalIssueBlocker(graph, issue));
  const domainEvalIds = new Set(goalTargetNodeIds.filter(
    (id) => graph.nodes.find((node) => node.id === id)?.type === 'Eval',
  ));
  extra.eligibleEvals = evals.filter((node) => domainEvalIds.has(node.id)
      && ['pending', 'ready', 'active'].includes(node.status))
    .map((node) => node.id);
  extra.blockedEvals = evals.filter((node) => domainEvalIds.has(node.id)
      && ['stale', 'failed', 'blocked', 'stopped'].includes(node.status))
    .map((node) => ({ nodeId: node.id, reasons: [`eval_status:${node.status}`] }));

  if (selectedGoal?.status === 'complete') {
    if (goalCompletion?.ready) return baseResult(
      'loop', 'loop-controller', 'stop_complete', goalTargetNodeIds, [], extra,
    );
    if (goalCompletion?.stopped) return baseResult(
      'loop', 'loop-controller', 'stop_for_review', goalTargetNodeIds, goalBlockers, extra,
    );
    return baseResult(
      'loop', 'loop-controller', 'resolve_terminal_inconsistency', goalTargetNodeIds,
      [blocker(
        graph, 'premature_goal_completion', selectedGoal.id,
        uniqueTargets(goalBlockers.flatMap((item) => [item.nodeId, ...item.relatedNodeIds])
          .filter((id) => id !== selectedGoal.id)),
      ), ...goalBlockers], extra,
    );
  }

  const controlOrder = ['Goal', 'Baseline', 'Envelope', 'Budget'];
  const controlProblems = controlOrder.map((type) => ({
    type,
    resolution: selectedCoordinates.resolutions[type],
    issue: selectedCoordinates.issues.find((item) => item.code.endsWith(`_${type.toLowerCase()}_control`)),
  })).filter(({ resolution }) => resolution.status !== 'resolved');
  if (controlProblems.length > 0) {
    const { issue } = controlProblems[0];
    const action = issue.code.startsWith('missing_')
      ? 'repair_loop_controls'
      : issue.code === 'unavailable_baseline_control' ? 'approve_baseline'
        : issue.code === 'unavailable_envelope_control' ? 'approve_envelope'
          : issue.code === 'unavailable_budget_control' ? 'restore_budget'
            : issue.code === 'unavailable_goal_control' ? 'repair_goal'
              : 'resolve_control_coordinates';
    return baseResult(
      'loop', 'loop-controller', action,
      uniqueTargets([...(issue.candidateIds ?? []), selectedPhase.id]),
      [coordinateIssueBlocker(graph, issue)], extra,
    );
  }

  if (goalCompletion?.stopped) return baseResult(
    'loop', 'loop-controller', 'stop_for_review', goalTargetNodeIds, goalBlockers, extra,
  );

  const earlierDomainProblem = goalCompletion?.issues.filter((issue) => issue.nodeId !== selectedPhase.id
    && issue.nodeId !== selectedEvaluation?.id && issue.code !== 'phase_incomplete')
    .sort((left, right) => goalIssuePriority(left) - goalIssuePriority(right)
      || codeUnitCompare(`${left.code}\0${left.nodeId}`, `${right.code}\0${right.nodeId}`))[0];
  if (earlierDomainProblem) {
    if (earlierDomainProblem.code.startsWith('phase_eval_relation_')) return baseResult(
      'loop', 'loop-controller', earlierDomainProblem.code === 'phase_eval_relation_missing'
        ? 'define_phase_eval_relation' : 'resolve_phase_eval_relation',
      goalTargetNodeIds, goalBlockers, extra,
    );
    if (earlierDomainProblem.code.startsWith('eval_')) {
      const evaluation = graph.nodes.find((node) => node.id === earlierDomainProblem.nodeId);
      const actionable = evaluation && ['pending', 'ready', 'active'].includes(evaluation.status);
      return baseResult(
        'loop', evaluation?.owner ?? 'loop-controller', actionable ? 'evaluate_phase' : 'repair_phase_eval',
        goalTargetNodeIds, goalBlockers, extra,
      );
    }
    return baseResult(
      'loop', 'loop-controller', 'resolve_control_coordinates', goalTargetNodeIds, goalBlockers, extra,
    );
  }

  if (selectedCoordinates.evaluation.status !== 'resolved') {
    const relation = selectedCoordinates.evaluation;
    return baseResult(
      'loop', 'loop-controller', relation.status === 'missing'
        ? 'define_phase_eval_relation' : 'resolve_phase_eval_relation',
      uniqueTargets([relation.phaseId, ...(relation.evalIds ?? []), ...(relation.phaseIds ?? [])]),
      [relationIssueBlocker(graph, relation)], extra,
    );
  }

  if (selectedEvaluation?.status !== 'passed') {
    const actionable = ['pending', 'ready', 'active'].includes(selectedEvaluation.status);
    return baseResult(
      'loop', selectedEvaluation.owner ?? 'loop-controller', actionable ? 'evaluate_phase' : 'repair_phase_eval',
      [selectedEvaluation.id],
      [blocker(
        graph, `eval_${selectedEvaluation.status}`, selectedEvaluation.id,
        [selectedPhase.id], `eval_status:${selectedEvaluation.status}`,
      )], extra,
    );
  }

  const selectedDetail = phaseDetails.find((detail) => detail.phase.id === selectedPhase.id);
  if (selectedDetail?.blockers.length > 0) return baseResult(
    'loop', 'loop-controller', 'repair_phase_plan', [selectedPhase.id], selectedDetail.blockers, extra,
  );

  if (selectedPhase.status === 'active') return baseResult(
    'loop', selectedPhase.owner ?? 'master', 'continue_phase', [selectedPhase.id], [], extra,
  );
  if (selectedPhase.status === 'ready') {
    return baseResult(
      'loop', selectedPhase.owner ?? 'master', 'handoff_phase', [selectedPhase.id], [],
      { ...extra, controls: selectedCoordinates.controls },
    );
  }

  if (selectedPhase.status === 'complete') {
    if (selectedGoal?.status === 'active' && goalCompletion?.ready) return baseResult(
      'loop', 'loop-controller', 'complete_goal', goalTargetNodeIds, [], extra,
    );
  }

  return baseResult(
    'loop', 'loop-controller', 'repair_phase_plan', [selectedPhase.id],
    [blocker(graph, `phase_status_${selectedPhase.status}`, selectedPhase.id)], extra,
  );
}

export function queryNext(graph) {
  return graph.graphKind === 'loop' ? loopNext(graph) : masterNext(graph);
}

export { directPrerequisiteIds };
