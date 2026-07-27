import { SCHEMA_VERSION } from './constants.mjs';
import { finding, WorkflowBlockedError } from './errors.mjs';
import { createEventResolver, writeGraphFile, writeRuntimeEvent } from './io.mjs';
import {
  evaluateGoalCompletion,
  gateDependsOnTask,
  resolveCurrentGoal,
  resolvePhaseEvalRelation,
} from './relations.mjs';
import { writeGraphView } from './render.mjs';

const transitions = Object.freeze({
  Requirement: { pending: ['planned', 'ready', 'blocked'], planned: ['ready', 'stale', 'blocked'], ready: ['active', 'stale', 'blocked'], active: ['complete', 'stale', 'blocked'], stale: ['planned', 'ready', 'blocked'], blocked: ['planned', 'ready'] },
  Task: { pending: ['planned', 'blocked'], planned: ['ready', 'stale', 'blocked'], ready: ['in_progress', 'stale', 'blocked'], in_progress: ['complete', 'failed', 'blocked', 'stale'], stale: ['planned', 'blocked'], blocked: ['ready', 'planned'], failed: ['planned', 'blocked'] },
  Test: { pending: ['planned', 'ready', 'blocked'], planned: ['ready', 'stale', 'blocked'], ready: ['active', 'stale', 'blocked'], active: ['passed', 'failed', 'blocked'], passed: ['stale'], failed: ['ready', 'blocked'], stale: ['planned', 'ready', 'blocked'], blocked: ['planned', 'ready'] },
  Gate: { pending: ['passed', 'rejected', 'blocked'], blocked: ['pending', 'rejected'], rejected: ['pending'], passed: ['stale'], stale: ['pending'] },
  Evidence: { pending: ['passed', 'failed', 'stale'], passed: ['stale'], failed: ['pending'], stale: ['pending'] },
  Git: { pending: ['ready', 'blocked'], ready: ['active', 'complete', 'blocked'], active: ['complete', 'failed', 'blocked'], failed: ['ready'], stale: ['pending', 'ready', 'blocked'], blocked: ['ready'] },
  Failure: { pending: ['active', 'resolved'], active: ['resolved', 'blocked'], stale: ['pending', 'active', 'blocked'], blocked: ['active', 'resolved'] },
  Goal: { pending: ['active', 'stopped'], active: ['complete', 'stopped', 'blocked'], stale: ['pending', 'active', 'stopped'], blocked: ['active', 'stopped'] },
  Baseline: { pending: ['passed', 'approved', 'user_confirmed', 'rejected', 'blocked'], passed: ['stale'], approved: ['stale'], user_confirmed: ['stale'], stale: ['pending'], rejected: ['pending'], blocked: ['pending'] },
  Phase: { pending: ['ready', 'blocked'], ready: ['active', 'stale', 'blocked'], active: ['complete', 'failed', 'blocked', 'stale'], blocked: ['ready', 'stopped'], failed: ['ready', 'stopped'], stale: ['ready', 'stopped'] },
  Envelope: { pending: ['passed', 'approved', 'rejected', 'blocked'], passed: ['stale'], approved: ['stale'], stale: ['pending'], rejected: ['pending'], blocked: ['pending'] },
  Budget: { pending: ['active', 'available', 'stopped'], active: ['available', 'exhausted', 'stopped', 'blocked'], available: ['active', 'exhausted', 'stopped', 'blocked'], stale: ['pending', 'active', 'available', 'stopped'], blocked: ['active', 'available', 'stopped'] },
  Eval: { pending: ['ready', 'active', 'blocked'], ready: ['active', 'blocked'], active: ['passed', 'failed', 'blocked'], stale: ['pending', 'ready', 'active', 'stopped'], blocked: ['active', 'stopped'], failed: ['active', 'stopped'] },
});

const satisfiedStatuses = new Set(['passed', 'complete', 'resolved']);

function transitionFinding(code, rule, nodeId, message, path = '/nodes') {
  return finding(code, rule, path, nodeId ? [nodeId] : [], message);
}

function hasPermission(graph, actorId, nodeId, capabilityException) {
  const matching = graph.permissions.filter((permission) =>
    permission.actorId === actorId
    && permission.action === 'transition'
    && (permission.resourceRef === nodeId || permission.resourceRef === '*'));
  if (matching.some((permission) => permission.effect === 'deny')) return false;
  return matching.some((permission) => permission.effect === 'allow');
}

function relatedGates(graph, nodeIds) {
  const targets = new Set(nodeIds);
  const related = new Set();
  for (const nodeId of targets) {
    const node = graph.nodes.find((item) => item.id === nodeId);
    for (const relatedId of node?.relatedNodeIds ?? []) related.add(relatedId);
  }
  for (const gate of graph.nodes.filter((item) => item.type === 'Gate')) {
    if ((gate.relatedNodeIds ?? []).some((id) => targets.has(id))) related.add(gate.id);
  }
  for (const edge of graph.edges) {
    if (edge.type === 'requires' && targets.has(edge.from)) related.add(edge.to);
  }
  return graph.nodes.filter((item) => item.type === 'Gate' && related.has(item.id));
}

function phaseEvaluationFindings(graph, phase, subjectId = phase.id) {
  const findings = [];
  const relation = resolvePhaseEvalRelation(graph, phase.id);
  if (relation.status !== 'resolved') {
    const code = relation.status === 'missing'
      ? 'phase_eval_relation_missing'
      : relation.status === 'shared' ? 'phase_eval_relation_shared' : 'phase_eval_relation_ambiguous';
    findings.push(transitionFinding(
      code,
      relation.status === 'missing'
        ? 'transition.phase_eval_relation_explicit'
        : 'transition.phase_eval_relation_unique',
      subjectId,
      `Phase ${phase.id} has ${relation.status} Eval relation`,
    ));
    return findings;
  }
  const evaluation = graph.nodes.find((item) => item.id === relation.evalId);
  if (evaluation?.status !== 'passed') findings.push(transitionFinding(
    'phase_eval_required', 'transition.phase_eval_passed', subjectId,
    `Phase ${phase.id} requires passed Eval ${relation.evalId}`,
  ));
  return findings;
}

function completionFindings(graph, node, toStatus) {
  if (toStatus !== 'complete') return [];
  const findings = [];
  if (node.type === 'Requirement') {
    const tasks = graph.edges
      .filter((edge) => edge.type === 'implements' && edge.from === node.id)
      .map((edge) => graph.nodes.find((item) => item.id === edge.to))
      .filter(Boolean);
    const tests = graph.edges
      .filter((edge) => edge.type === 'verifies' && edge.to === node.id)
      .map((edge) => graph.nodes.find((item) => item.id === edge.from))
      .filter(Boolean);
    for (const task of tasks.filter((item) => item.status !== 'complete')) findings.push(transitionFinding(
      'implementation_incomplete', 'transition.requirement_tasks_complete', node.id,
      `Requirement ${node.id} has incomplete Task ${task.id}`,
    ));
    for (const test of tests.filter((item) => !['passed', 'complete'].includes(item.status))) findings.push(transitionFinding(
      'verification_incomplete', 'transition.requirement_tests_passed', node.id,
      `Requirement ${node.id} has incomplete Test ${test.id}`,
    ));
    for (const gate of relatedGates(graph, [node.id]).filter((item) => item.status !== 'passed')) findings.push(transitionFinding(
      'gate_required', 'transition.related_gates_passed', node.id,
      `Requirement ${node.id} is blocked by Gate ${gate.id}`,
    ));
  }
  if (node.type === 'Task') {
    const requirementIds = graph.edges
      .filter((edge) => edge.type === 'implements' && edge.to === node.id)
      .map((edge) => edge.from);
    const tests = graph.edges
      .filter((edge) => edge.type === 'verifies' && requirementIds.includes(edge.to))
      .map((edge) => graph.nodes.find((item) => item.id === edge.from))
      .filter(Boolean);
    for (const test of tests.filter((item) => !['passed', 'complete'].includes(item.status))) findings.push(transitionFinding(
      'test_evidence_required', 'transition.related_tests_passed', node.id,
      `Task ${node.id} is blocked by Test ${test.id}`,
    ));
    for (const gate of relatedGates(graph, [node.id, ...requirementIds]).filter(
      (item) => item.status !== 'passed' && !gateDependsOnTask(graph, item.id, node.id),
    )) findings.push(transitionFinding(
      'gate_required', 'transition.related_gates_passed', node.id,
      `Task ${node.id} is blocked by Gate ${gate.id}`,
    ));
  }
  if (node.type === 'Phase') findings.push(...phaseEvaluationFindings(graph, node));
  if (node.type === 'Goal') {
    const completion = evaluateGoalCompletion(graph, node.id, { goalStatuses: [node.status] });
    for (const issue of completion.issues) {
      const code = issue.code.startsWith('eval_') ? 'phase_eval_required' : issue.code;
      const rule = issue.code === 'phase_incomplete' || issue.code === 'phase_stopped'
        ? 'transition.goal_phases_complete'
        : issue.code.startsWith('eval_') || issue.code.startsWith('phase_eval_relation_')
          ? 'transition.phase_eval_passed'
          : issue.code.startsWith('goal_domain_')
            ? 'transition.goal_phase_scope_declared'
            : 'transition.goal_control_coordinates_resolved';
      findings.push(transitionFinding(
        code,
        rule,
        node.id,
        `Goal ${node.id} completion is blocked by ${issue.code} at ${issue.nodeId ?? '<missing>'}`,
      ));
    }
  }
  return findings;
}

function currentGoalTransitionFindings(graph, node, toStatus) {
  if (graph.graphKind !== 'loop' || node.type !== 'Goal'
    || !['complete', 'stopped'].includes(toStatus)) return [];
  const current = resolveCurrentGoal(graph);
  if (current.status === 'ambiguous') return [transitionFinding(
    'ambiguous_current_goal',
    'transition.current_goal_resolved',
    node.id,
    `Goal ${node.id} cannot enter ${toStatus} while the current Goal is ambiguous`,
  )];
  if (current.status !== 'resolved') return [transitionFinding(
    'current_goal_missing',
    'transition.current_goal_resolved',
    node.id,
    `Goal ${node.id} cannot enter ${toStatus} without a resolved current Goal`,
  )];
  if (current.goalId !== node.id) return [transitionFinding(
    'goal_not_current',
    'transition.current_goal_matches_target',
    node.id,
    `Goal ${node.id} cannot enter ${toStatus}; current Goal is ${current.goalId}`,
  )];
  return [];
}

function prerequisiteFindings(graph, node, toStatus, now) {
  const findings = [];
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const terminalTarget = ['passed', 'complete'].includes(toStatus);
  if (terminalTarget) {
    for (const prerequisiteId of node.prerequisiteIds ?? []) {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite || !satisfiedStatuses.has(prerequisite.status)) {
        findings.push(transitionFinding(
          prerequisite?.type === 'Evidence' ? 'evidence_required' : 'prerequisite_blocked',
          'transition.prerequisites_satisfied',
          node.id,
          `Node ${node.id} requires satisfied prerequisite ${prerequisiteId}`,
        ));
        continue;
      }
      if (prerequisite.type === 'Evidence') {
        const subject = byId.get(prerequisite.subjectId);
        const fresh = prerequisite.subjectHash === subject?.hash
          && prerequisite.sourceRevision === subject?.sourceRevision
          && Date.parse(prerequisite.expiresAt) > now;
        if (!fresh) findings.push(transitionFinding(
          'evidence_required',
          'transition.evidence_fresh',
          node.id,
          `Node ${node.id} requires fresh evidence ${prerequisiteId}`,
        ));
      }
    }
  }
  findings.push(...completionFindings(graph, node, toStatus));
  return findings;
}

export function planTransition(graph, options) {
  const nodeId = options?.nodeId;
  const actorId = options?.actorId;
  const toStatus = options?.toStatus === 'completed' ? 'complete' : options?.toStatus;
  const node = graph.nodes.find((item) => item.id === nodeId);
  const findings = [];
  if (!graph.authority?.graphMutationAllowed || graph.authority?.mode !== 'graph') {
    findings.push(transitionFinding(
      'authority_read_only', 'authority.single_writer', undefined,
      `${graph.authority?.mode ?? 'legacy'} authority does not permit Graph mutation`, '/authority/mode',
    ));
    throw new WorkflowBlockedError('authority_read_only', findings);
  }
  if (!node) {
    findings.push(transitionFinding('node_not_found', 'transition.node_exists', nodeId, `Node ${nodeId ?? '<missing>'} does not exist`));
  } else {
    const allowed = transitions[node.type]?.[node.status] ?? [];
    if (!allowed.includes(toStatus)) findings.push(transitionFinding(
      'illegal_transition', 'transition.adjacency', node.id,
      `Illegal ${node.type} transition ${node.status} -> ${toStatus ?? '<missing>'}`,
    ));
    if (!hasPermission(graph, actorId, node.id, options.capabilityException)) findings.push(transitionFinding(
      'permission_denied', 'transition.permission_grant', node.id,
      `Actor ${actorId ?? '<missing>'} lacks an unopposed transition grant for ${node.id}`,
    ));
    findings.push(...currentGoalTransitionFindings(graph, node, toStatus));
    const now = options.now === undefined
      ? new Date(options.occurredAt ?? Date.now()).getTime()
      : new Date(options.now).getTime();
    findings.push(...prerequisiteFindings(graph, node, toStatus, now));
  }
  if (findings.length > 0) throw new WorkflowBlockedError('ILLEGAL_TRANSITION', findings, 'Illegal graph transition');

  const nextGraph = structuredClone(graph);
  nextGraph.nodes.find((item) => item.id === nodeId).status = toStatus;
  nextGraph.revision += 1;
  return { graph: nextGraph, node, fromStatus: node.status, toStatus };
}

export async function commitTransition(options) {
  const planned = planTransition(options.graph, options);
  if (!options.graphPath || !options.runtimeDirectory) {
    throw new TypeError('Legal transition requires graphPath and runtimeDirectory');
  }
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const event = {
    schemaVersion: SCHEMA_VERSION,
    id: options.eventId ?? `event.${options.nodeId}.${planned.graph.revision}`,
    graphId: options.graph.id,
    eventType: 'transition',
    occurredAt,
    actorId: options.actorId,
    subjectIds: [options.nodeId],
    payload: {
      from: planned.fromStatus,
      to: planned.toStatus,
      ...(options.capabilityException ? { capabilityException: options.capabilityException } : {}),
    },
  };
  const eventRef = await writeRuntimeEvent(options.runtimeDirectory, event, {
    referenceRoot: options.referenceRoot,
  });
  planned.graph.eventRefs.push(eventRef);
  const transitionedNode = planned.graph.nodes.find((node) => node.id === options.nodeId);
  transitionedNode.eventRefIds = [...new Set([...(transitionedNode.eventRefIds ?? []), eventRef.id])];
  await writeGraphFile(options.graphPath, planned.graph, {
    eventResolver: createEventResolver(options.runtimeDirectory, { referenceRoot: options.referenceRoot }),
  });
  if (options.viewPath) await writeGraphView(options.viewPath, planned.graph);
  return { ...planned, event, eventRef };
}
