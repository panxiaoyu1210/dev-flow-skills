import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  SCHEMA_IDS,
  acceptPhaseHandoff,
  buildMinimalContext,
  checkGraph,
  computeImpact,
  consumePhaseResult,
  createAcceptanceResult,
  createPhaseHandoff,
  planTransition,
  queryNext,
  validateContract,
} from '../lib/graph/index.mjs';

const cli = new URL('../bin/dev-flow.mjs', import.meta.url).pathname;

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

function permit(graph, actorId, resourceRef) {
  graph.permissions.push({
    id: `permission.${actorId}.${resourceRef}`,
    actorId,
    action: 'transition',
    resourceRef,
    effect: 'allow',
  });
}

function readyLoop(loop) {
  loop.authority = {
    mode: 'graph', sourceOfTruth: 'graph', syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true, markdownViewReadableAsAuthority: false,
  };
  loop.nodes.find((node) => node.type === 'Phase').status = 'ready';
  loop.nodes.find((node) => node.type === 'Baseline').status = 'passed';
  loop.nodes.find((node) => node.type === 'Envelope').status = 'passed';
  loop.nodes.find((node) => node.type === 'Budget').status = 'active';
  return loop;
}

function readyMaster(master) {
  master.nodes.find((node) => node.type === 'Requirement').status = 'complete';
  master.nodes.find((node) => node.type === 'Task').status = 'complete';
  master.nodes.find((node) => node.type === 'Test').status = 'passed';
  master.nodes.find((node) => node.type === 'Gate').status = 'passed';
  master.nodes.find((node) => node.type === 'Git').status = 'complete';
  master.nodes.find((node) => node.type === 'Failure').status = 'resolved';
  return master;
}

test('Legacy is graph absence; init and residual legacy authority never route from Graph', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-review-legacy-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graphPath = path.join(directory, 'legacy.json');
  const init = run(directory, 'graph', 'init', '--graph', graphPath, '--type', 'master', '--mode', 'legacy', '--json');
  assert.equal(init.status, 0, init.stderr);
  await assert.rejects(access(graphPath));
  assert.equal(JSON.parse(init.stdout).data.authorityMode, 'legacy');

  const residual = await fixture('valid-master');
  residual.authority = {
    mode: 'legacy', sourceOfTruth: 'markdown', syncDirection: 'none',
    graphMutationAllowed: false, markdownViewReadableAsAuthority: true,
  };
  residual.nodes.find((node) => node.type === 'Gate').status = 'passed';
  await writeFile(graphPath, `${JSON.stringify(residual)}\n`);
  for (const args of [
    ['check'], ['next'], ['context', '--node', 'missing'],
  ]) {
    const result = run(directory, 'graph', ...args, '--graph', graphPath, '--json');
    assert.equal(result.status, 0, `${args[0]}: ${result.stdout} ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).data.authorityMode, 'legacy');
  }
  const impact = run(directory, 'graph', 'impact', '--graph', graphPath,
    '--kind', 'task', '--source', 'task.checkout', '--json');
  assert.equal(impact.status, 3);
  assert.equal(JSON.parse(impact.stdout).error.code, 'unknown_impact');
  assert.equal(run(directory, 'graph', 'impact', '--graph', graphPath, '--kind', 'task', '--source', 'task.checkout', '--apply', '--json').status, 3);
});

test('Shadow init snapshots Markdown projection and blocks hash or structure drift before routing', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-review-shadow-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const markdownPath = path.join(directory, 'state.md');
  const graphPath = path.join(directory, 'shadow.json');
  const markdown = '# State\n\n```dev-flow-graph\n{"nodes":[],"edges":[],"permissions":[]}\n```\n';
  await writeFile(markdownPath, markdown);
  const missing = run(directory, 'graph', 'init', '--graph', graphPath, '--type', 'master', '--mode', 'shadow', '--json');
  assert.equal(missing.status, 2);
  const init = run(directory, 'graph', 'init', '--graph', graphPath, '--type', 'master', '--mode', 'shadow', '--markdown', markdownPath, '--json');
  assert.equal(init.status, 0, init.stderr);
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  assert.equal(graph.authority.markdownSources.length, 1);
  assert.deepEqual(graph.nodes, []);
  assert.equal(run(directory, 'graph', 'next', '--graph', graphPath, '--json').status, 0);

  graph.nodes.push({ id: 'failure.tampered', type: 'Failure', status: 'resolved' });
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  assert.equal(run(directory, 'graph', 'check', '--graph', graphPath, '--json').status, 2);
  graph.nodes = [];
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  await writeFile(markdownPath, '# State\n\n```dev-flow-graph\n'
    + '{"nodes":[{"id":"failure.changed","type":"Failure","status":"active"}],"edges":[],"permissions":[]}\n'
    + '```\n');
  for (const command of ['check', 'next', 'context']) {
    assert.equal(run(directory, 'graph', command, '--graph', graphPath, '--json').status, 2, command);
  }
  assert.equal(run(directory, 'graph', 'impact', '--graph', graphPath, '--kind', 'file', '--source', 'x', '--json').status, 2);
});

test('impact treats touched unmodelled edges conservatively and freezes known non-propagating edges', async () => {
  const graph = await fixture('valid-master');
  graph.edges.push({ id: 'edge.unknown', type: 'relates_to', from: 'task.checkout', to: 'gate.checkout' });
  const unknown = computeImpact(graph, { kind: 'task', source: 'task.checkout' });
  assert.equal(unknown.unknownImpact, true);
  assert.equal(unknown.classification, 'unknown_impact');
  assert.ok(unknown.reasonCodes.includes('unmodelled_edge:relates_to'));
  graph.edges.pop();
  graph.edges.push({ id: 'edge.permission', type: 'authorizes', from: 'gate.checkout', to: 'task.checkout' });
  assert.equal(computeImpact(graph, { kind: 'task', source: 'task.checkout' }).unknownImpact, false);
});

test('next excludes blocked phases, is reorder-stable, and does not deadlock Gate prerequisite Tasks', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  loop.nodes.find((node) => node.type === 'Phase').status = 'blocked';
  const loopNext = queryNext(loop);
  assert.deepEqual(loopNext.eligiblePhases, []);
  assert.deepEqual(loopNext.blockedPhases, [{ nodeId: 'phase.checkout', reasons: ['phase_status:blocked'] }]);

  const master = await fixture('valid-master');
  const gate = master.nodes.find((node) => node.type === 'Gate');
  gate.prerequisiteIds = ['task.checkout'];
  master.nodes.find((node) => node.type === 'Task').status = 'planned';
  const first = queryNext(master);
  assert.deepEqual(first.eligibleTasks, ['task.checkout']);
  const reordered = structuredClone(master);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(queryNext(reordered), first);
});

test('Requirement and Task terminal transitions inspect only linked completion evidence', async () => {
  const graph = await fixture('valid-master');
  const requirement = graph.nodes.find((node) => node.type === 'Requirement');
  requirement.status = 'active';
  permit(graph, 'owner.requirement', requirement.id);
  assert.throws(
    () => planTransition(graph, { nodeId: requirement.id, toStatus: 'complete', actorId: 'owner.requirement' }),
    (error) => error.findings.some((item) => item.code === 'implementation_incomplete'),
  );
  graph.nodes.find((node) => node.type === 'Task').status = 'complete';
  graph.nodes.find((node) => node.type === 'Test').status = 'passed';
  assert.equal(planTransition(graph, { nodeId: requirement.id, toStatus: 'complete', actorId: 'owner.requirement' }).toStatus, 'complete');

  const task = graph.nodes.find((node) => node.type === 'Task');
  task.status = 'in_progress';
  permit(graph, 'owner.task', task.id);
  graph.nodes.find((node) => node.type === 'Gate').status = 'pending';
  assert.equal(planTransition(graph, { nodeId: task.id, toStatus: 'complete', actorId: 'owner.task' }).toStatus, 'complete');
});

test('passing acceptance requires ready Master evidence and phase-result binds actual Master Graph', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const incomplete = await fixture('valid-master');
  const incompleteHandoff = createPhaseHandoff(loop, incomplete, {
    handoffId: 'handoff.incomplete', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedIncomplete = acceptPhaseHandoff(incompleteHandoff, loop, incomplete).masterGraph;
  assert.throws(
    () => createAcceptanceResult(admittedIncomplete, loop, incompleteHandoff, { resultId: 'result.bad', outcome: 'passed' }),
    (error) => error.exitCode === 3 && error.findings.some((item) => item.code === 'acceptance_not_ready'),
  );

  const master = readyMaster(await fixture('valid-master'));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.ready', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
  const result = createAcceptanceResult(admittedMaster, loop, handoff, {
    resultId: 'result.ready', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });
  assert.equal(consumePhaseResult(loop, admittedMaster, handoff, result).action, 'next_phase');
  const forged = structuredClone(result);
  forged.masterGraph.hash = 'f'.repeat(64);
  assert.throws(() => consumePhaseResult(loop, admittedMaster, handoff, forged), (error) => error.exitCode === 3);
});

test('capability exception is audit metadata and cannot grant an arbitrary actor', async () => {
  const graph = await fixture('valid-master');
  assert.throws(() => planTransition(graph, {
    nodeId: 'gate.checkout', toStatus: 'passed', actorId: 'arbitrary.actor',
    capabilityException: {
      kind: 'capability_exception', actorId: 'arbitrary.actor', action: 'transition',
      resourceRef: 'gate.checkout', reason: 'free text must not authorize',
    },
  }), (error) => error.findings.some((item) => item.code === 'permission_denied'));
});

test('handoff requires eligible Loop controls and rejects every rebound projection field', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const master = await fixture('valid-master');
  loop.nodes.find((node) => node.type === 'Phase').status = 'blocked';
  assert.throws(() => createPhaseHandoff(loop, master, { handoffId: 'handoff.bad', phaseId: 'phase.checkout' }), (error) => error.exitCode === 3);
  loop.nodes.find((node) => node.type === 'Phase').status = 'ready';
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.good', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  for (const mutate of [
    (value) => value.requirementRefs.push('openspec/forged.md'),
    (value) => value.artifactRefs.pop(),
    (value) => { value.envelopeRef = 'Docs/forged.md'; },
    (value) => { value.envelopeSummary.status = 'rejected'; },
    (value) => { value.budgetRef = 'Docs/forged.md'; },
    (value) => { value.budgetSummary.hash = 'e'.repeat(64); },
  ]) {
    const forged = structuredClone(handoff);
    mutate(forged);
    assert.throws(() => acceptPhaseHandoff(forged, loop, master), (error) => error.exitCode === 3);
  }
});

test('context rejects missing targets and includes only directly related Gates', async () => {
  const graph = await fixture('valid-master');
  const task = graph.nodes.find((node) => node.type === 'Task');
  task.relatedNodeIds = ['gate.checkout'];
  graph.nodes.push({ id: 'gate.unrelated', type: 'Gate', status: 'passed', prerequisiteIds: ['evidence.checkout'] });
  assert.throws(() => buildMinimalContext(graph, { nodeId: 'task.absent' }), (error) => [2, 3].includes(error.exitCode));
  const context = buildMinimalContext(graph, { nodeId: task.id });
  assert.ok(context.nodeSummaries.some((node) => node.id === 'gate.checkout'));
  assert.ok(!context.nodeSummaries.some((node) => node.id === 'gate.unrelated'));
});

test('eventRef persists a resolvable ref across custom run-id and default check', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-review-event-ref-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graph = await fixture('valid-master');
  const graphPath = path.join(directory, 'graph.json');
  await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
  const transition = run(directory, 'graph', 'transition', '--graph', graphPath, '--node', 'gate.checkout', '--to', 'passed', '--actor', 'checker.checkout', '--run-id', 'custom-run', '--json');
  assert.equal(transition.status, 0, `${transition.stdout} ${transition.stderr}`);
  const persisted = JSON.parse(await readFile(graphPath, 'utf8'));
  assert.match(persisted.eventRefs[0].ref, /^\.dev-flow\/runtime\/custom-run\//);
  assert.equal(run(directory, 'graph', 'check', '--graph', graphPath, '--json').status, 0);
});

test('node schema freezes status vocabulary per type', () => {
  assert.equal(validateContract({ id: 'task.bad', type: 'Task', status: 'passed' }, SCHEMA_IDS.node).valid, false);
  assert.equal(validateContract({ id: 'gate.bad', type: 'Gate', status: 'in_progress' }, SCHEMA_IDS.node).valid, false);
  assert.equal(validateContract({ id: 'budget.ok', type: 'Budget', status: 'available' }, SCHEMA_IDS.node).valid, true);
});

test('CLI syntax failures are validation exit 2 with stable JSON errors', () => {
  for (const args of [
    ['graph', 'next', '--json'],
    ['graph', 'unknown', '--graph', 'x.json', '--json'],
    ['graph', 'check', '--graph', 'x.json', '--unexpected', '--json'],
  ]) {
    const result = run(process.cwd(), ...args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout} ${result.stderr}`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'cli_syntax_invalid');
    assert.deepEqual(Object.keys(envelope.error.findings[0]), ['code', 'rule', 'path', 'nodeIds', 'message']);
  }
});

test('invalid Evidence expiry emits one authoritative finding at its path', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.type === 'Evidence').expiresAt = '2026-13-01T00:00:00Z';
  const result = await checkGraph(graph);
  const findings = result.findings.filter((item) => item.path === '/nodes/3/expiresAt');
  assert.equal(findings.length, 1);
});

test('acceptance and phase evaluation reject Loop handoff coordinate drift with reissue routing', async () => {
  const loop = readyLoop(await fixture('valid-loop'));
  const master = readyMaster(await fixture('valid-master'));
  const handoff = createPhaseHandoff(loop, master, {
    handoffId: 'handoff.drift', phaseId: 'phase.checkout', issuedAt: '2026-07-24T10:00:00.000Z',
  });
  const admittedMaster = acceptPhaseHandoff(handoff, loop, master).masterGraph;
  const acceptance = createAcceptanceResult(admittedMaster, loop, handoff, {
    resultId: 'result.drift', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
  });

  for (const mutate of [
    (value) => { value.revision += 1; },
    (value) => { value.nodes.find((node) => node.type === 'Baseline').hash = 'a'.repeat(64); },
    (value) => { value.nodes.find((node) => node.type === 'Phase').hash = 'b'.repeat(64); },
    (value) => { value.nodes.find((node) => node.type === 'Envelope').status = 'approved'; },
  ]) {
    const drifted = structuredClone(loop);
    mutate(drifted);
    assert.throws(
      () => createAcceptanceResult(admittedMaster, drifted, handoff, {
        resultId: 'result.rejected', outcome: 'passed', issuedAt: '2026-07-24T11:00:00.000Z',
      }),
      (error) => error.exitCode === 3
        && error.code === 'loop_baseline_change'
        && error.route?.owner === 'loop-controller'
        && error.route?.action === 'reissue_handoff',
    );
    assert.throws(
      () => consumePhaseResult(drifted, admittedMaster, handoff, acceptance),
      (error) => error.exitCode === 3
        && error.code === 'loop_baseline_change'
        && error.route?.action === 'reissue_handoff',
    );
  }
});

test('CLI maps malformed JSON and schema-invalid Shadow to one validation envelope', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dev-flow-review-cli-json-'));
  t.after(async () => (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }));
  const graphPath = path.join(directory, 'graph.json');
  await writeFile(graphPath, '{"broken":\n');
  const malformed = run(directory, 'graph', 'check', '--graph', graphPath, '--json');
  assert.equal(malformed.status, 2, `${malformed.stdout} ${malformed.stderr}`);
  assert.equal(malformed.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(malformed.stdout).error.code, 'graph_json_invalid');

  const shadow = await fixture('valid-loop');
  delete shadow.authority.markdownSources;
  await writeFile(graphPath, `${JSON.stringify(shadow)}\n`);
  const invalidShadow = run(directory, 'graph', 'check', '--graph', graphPath, '--json');
  assert.equal(invalidShadow.status, 2, `${invalidShadow.stdout} ${invalidShadow.stderr}`);
  assert.equal(invalidShadow.stdout.trim().split('\n').length, 1);
  const envelope = JSON.parse(invalidShadow.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'graph_validation_failed');
  assert.ok(envelope.error.findings.every((finding) => finding.code === 'schema_invalid'));
});

test('explicit context filters blockers to the selected governance closure', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.push({
    id: 'task.unrelated', type: 'Task', status: 'blocked', owner: 'other',
    actorId: 'maker.other', reviewerActorId: 'reviewer.other', files: ['src/other.mjs'],
  });
  const global = buildMinimalContext(graph);
  assert.ok(!global.blockedNodeIds.includes('task.unrelated'));
  assert.ok(!global.nodeSummaries.some((node) => node.id === 'task.unrelated'));
  const selected = buildMinimalContext(graph, { nodeId: 'task.checkout' });
  assert.deepEqual(selected.blockedNodeIds, []);
  assert.ok(!selected.reasonCodes.some((reason) => reason.includes('task.unrelated')));
  assert.ok(!selected.nodeSummaries.some((node) => node.id === 'task.unrelated'));
});
