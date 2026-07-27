import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SCHEMA_IDS,
  compileSchemas,
  sha256,
  stableStringify,
  validateContract,
  validateGraphSchema,
  checkGraph,
} from '../lib/graph/index.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/graph/${name}.json`, import.meta.url), 'utf8'));
}

async function contractFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/contracts/${name}.json`, import.meta.url), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function codes(result) {
  return result.findings.map((finding) => finding.code);
}

test('Ajv draft 2020 compiles every versioned public contract', () => {
  const validators = compileSchemas();
  for (const schemaId of Object.values(SCHEMA_IDS)) {
    assert.equal(typeof validators.getSchema(schemaId), 'function', schemaId);
  }
});

test('every public contract has an isolated valid and single-rule invalid fixture', async () => {
  const fixtureCases = [
    ['graph', SCHEMA_IDS.graph, 'valid-graph', 'invalid-graph'],
    ['node', SCHEMA_IDS.node, 'valid-node', 'invalid-node'],
    ['edge', SCHEMA_IDS.edge, 'valid-edge', 'invalid-edge'],
    ['event', SCHEMA_IDS.event, 'valid-event', 'invalid-event'],
    ['context', SCHEMA_IDS.context, 'valid-context', 'invalid-context'],
    ['handoff receipt', SCHEMA_IDS.handoffReceipt, 'valid-handoff-receipt', 'invalid-handoff-receipt'],
    ['master graph', SCHEMA_IDS.masterGraph, '../graph/valid-master', '../graph/schema-invalid-master'],
    ['loop graph', SCHEMA_IDS.loopGraph, '../graph/valid-loop', '../graph/schema-invalid-loop'],
    ['phase handoff', SCHEMA_IDS.phaseHandoff, 'valid-phase-handoff', 'invalid-phase-handoff'],
    ['phase result', SCHEMA_IDS.phaseResult, 'valid-phase-result', 'invalid-phase-result'],
  ];

  for (const [label, schemaId, validName, invalidName] of fixtureCases) {
    const valid = validateContract(await contractFixture(validName), schemaId);
    const invalid = validateContract(await contractFixture(invalidName), schemaId);
    assert.equal(valid.valid, true, `${label} valid fixture: ${JSON.stringify(valid.errors)}`);
    assert.equal(invalid.valid, false, `${label} invalid fixture`);
  }
});

test('phase handoff only permits Loop-to-Master direction', async () => {
  const invalid = validateContract(
    await contractFixture('invalid-phase-handoff'),
    SCHEMA_IDS.phaseHandoff,
  );
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some(
    (error) => error.instancePath === '/direction' && error.keyword === 'const',
  ));
});

test('timestamp contract rejects impossible UTC calendar values and keeps valid leap-day fractions', async () => {
  for (const name of ['invalid-evidence-captured-at', 'invalid-evidence-expires-at']) {
    const result = validateContract(await contractFixture(name), SCHEMA_IDS.node);
    assert.equal(result.valid, false, name);
    assert.ok(result.errors.some((error) => error.keyword === 'format'), name);
  }

  const eventResult = validateContract(
    await contractFixture('invalid-event-timestamp'),
    SCHEMA_IDS.event,
  );
  assert.equal(eventResult.valid, false);
  assert.ok(eventResult.errors.some(
    (error) => error.instancePath === '/occurredAt' && error.keyword === 'format',
  ));

  const validEvidence = await contractFixture('invalid-evidence-expires-at');
  validEvidence.expiresAt = '2028-02-29T23:59:59.999999Z';
  assert.equal(validateContract(validEvidence, SCHEMA_IDS.node).valid, true);
});

test('valid master and loop fixtures satisfy isolated graph schemas', async () => {
  const master = await fixture('valid-master');
  const loop = await fixture('valid-loop');
  assert.deepEqual(validateGraphSchema(master), { valid: true, errors: [] });
  assert.deepEqual(validateGraphSchema(loop), { valid: true, errors: [] });
  assert.equal((await checkGraph(master)).valid, true);
  assert.equal((await checkGraph(loop)).valid, true);
});

test('schema-invalid fixtures return stable machine-readable findings', async () => {
  for (const name of ['schema-invalid-master', 'schema-invalid-loop']) {
    const result = await checkGraph(await fixture(name));
    assert.equal(result.valid, false);
    assert.ok(result.findings.every((finding) => finding.code === 'schema_invalid'));
    assert.ok(result.findings.every((finding) => Object.keys(finding).join(',') === 'code,rule,path,nodeIds,message'));
  }
});

test('duplicate IDs are detected independently in every identity collection', async () => {
  const base = await fixture('valid-master');
  const cases = [
    ['nodes', base.nodes[0]],
    ['edges', base.edges[0]],
    ['permissions', base.permissions[0]],
    ['eventRefs', { id: 'event.same', ref: '.dev-flow/runtime/test/event.same.json', hash: 'a'.repeat(64) }],
  ];

  for (const [collection, value] of cases) {
    const graph = clone(base);
    graph[collection].push(clone(value), clone(value));
    const result = await checkGraph(graph);
    assert.ok(codes(result).includes('duplicate_id'), collection);
  }
});

test('missing node references are rejected for edges and node relations', async () => {
  const graph = await fixture('valid-master');
  graph.edges.push({ id: 'edge.missing', type: 'depends_on', from: 'task.checkout', to: 'task.absent' });
  graph.nodes.find((node) => node.type === 'Gate').prerequisiteIds.push('evidence.absent');
  const result = await checkGraph(graph);
  assert.ok(codes(result).includes('missing_reference'));
  assert.ok(result.findings.some((finding) => finding.path === '/edges/3/to'));
  assert.ok(result.findings.some((finding) => finding.path.includes('/prerequisiteIds/1')));
});

test('cycle detection applies only to declared acyclic depends_on/control edge types', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.push(
    { id: 'task.second', type: 'Task', status: 'planned', actorId: 'maker.2', reviewerActorId: 'reviewer.2' },
  );
  graph.edges.push(
    { id: 'edge.dep-one', type: 'depends_on', from: 'task.checkout', to: 'task.second' },
    { id: 'edge.dep-two', type: 'depends_on', from: 'task.second', to: 'task.checkout' },
  );
  assert.ok(codes(await checkGraph(graph)).includes('dag_cycle'));
  graph.acyclicEdgeTypes = ['control'];
  const tampered = await checkGraph(graph);
  assert.ok(codes(tampered).includes('schema_invalid'));
});

test('master coverage freezes Requirement-to-Task and Test-to-Requirement directions', async () => {
  const graph = await fixture('valid-master');
  graph.edges = graph.edges.filter((edge) => edge.type !== 'implements');
  assert.ok(codes(await checkGraph(graph)).includes('requirement_task_coverage_gap'));
  graph.edges = (await fixture('valid-master')).edges.filter((edge) => edge.type !== 'verifies');
  assert.ok(codes(await checkGraph(graph)).includes('test_requirement_coverage_gap'));

  const reversed = await fixture('valid-master');
  const implementsEdge = reversed.edges.find((edge) => edge.type === 'implements');
  [implementsEdge.from, implementsEdge.to] = [implementsEdge.to, implementsEdge.from];
  const verifiesEdge = reversed.edges.find((edge) => edge.type === 'verifies');
  [verifiesEdge.from, verifiesEdge.to] = [verifiesEdge.to, verifiesEdge.from];
  const reversedCodes = codes(await checkGraph(reversed));
  assert.ok(reversedCodes.includes('requirement_task_coverage_gap'));
  assert.ok(reversedCodes.includes('test_requirement_coverage_gap'));
});

test('parallel Task overlap is blocked unless explicitly serialized or safely integrated', async () => {
  const base = await fixture('valid-master');
  const task = base.nodes.find((node) => node.type === 'Task');
  const conflicting = {
    ...clone(task),
    id: 'task.conflicting',
    actorId: 'maker.2',
    reviewerActorId: 'reviewer.2',
    symbols: ['other'],
  };

  const graph = clone(base);
  graph.nodes.push(conflicting);
  assert.ok(codes(await checkGraph(graph)).includes('parallel_overlap_conflict'));

  conflicting.forcedSerial = true;
  assert.ok(!codes(await checkGraph(graph)).includes('parallel_overlap_conflict'));
  delete conflicting.forcedSerial;
  graph.nodes.find((node) => node.id === task.id).safeIntegrationRef = 'integration.checkout';
  conflicting.safeIntegrationRef = 'integration.checkout';
  assert.ok(!codes(await checkGraph(graph)).includes('parallel_overlap_conflict'));
});

test('Gate prerequisites, reviewer independence, evidence freshness, and permissions are governed', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.type === 'Gate').prerequisiteIds = [];
  const task = graph.nodes.find((node) => node.type === 'Task');
  task.reviewerActorId = task.actorId;
  graph.nodes.find((node) => node.type === 'Evidence').subjectHash = 'd'.repeat(64);
  graph.permissions.push({
    ...clone(graph.permissions[0]),
    id: 'permission.gate-deny',
    effect: 'deny',
  });

  const result = await checkGraph(graph);
  for (const code of [
    'gate_prerequisite_missing',
    'reviewer_not_independent',
    'evidence_stale',
    'permission_conflict',
  ]) {
    assert.ok(codes(result).includes(code), code);
  }
});

test('evidence sourceRevision is authoritative and timestamps are only auxiliary', async () => {
  const graph = await fixture('valid-master');
  const evidence = graph.nodes.find((node) => node.type === 'Evidence');
  evidence.capturedAt = '2000-01-01T00:00:00.000Z';
  assert.ok(!codes(await checkGraph(graph)).includes('evidence_stale'));
  evidence.sourceRevision = 'git:different';
  assert.ok(codes(await checkGraph(graph)).includes('evidence_stale'));
});

test('Evidence contract requires a complete stable evidence summary', async () => {
  const base = await fixture('valid-master');
  const requiredEvidenceFields = [
    'subjectId',
    'summary',
    'subjectHash',
    'sourceRevision',
    'capturedAt',
    'expiresAt',
  ];
  for (const field of requiredEvidenceFields) {
    const graph = clone(base);
    delete graph.nodes.find((node) => node.type === 'Evidence')[field];
    const result = await checkGraph(graph);
    assert.ok(codes(result).includes('schema_invalid'), field);
  }
});

test('Evidence is stale when expired or either subject integrity coordinate is absent', async () => {
  const expired = await fixture('valid-master');
  expired.nodes.find((node) => node.type === 'Evidence').expiresAt = '2026-07-24T10:00:00.000Z';
  assert.ok(codes(await checkGraph(expired, { now: '2026-07-25T00:00:00.000Z' })).includes('evidence_stale'));

  for (const field of ['hash', 'sourceRevision']) {
    const graph = await fixture('valid-master');
    delete graph.nodes.find((node) => node.type === 'Requirement')[field];
    assert.ok(codes(await checkGraph(graph)).includes('evidence_stale'), field);
  }
});

test('non-finite Evidence expiry returns one authoritative schema finding', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.type === 'Evidence').expiresAt = '2026-13-01T00:00:00Z';
  const result = await checkGraph(graph, { now: '2026-07-25T00:00:00Z' });
  const invalidExpiry = result.findings.find((finding) => finding.path === '/nodes/3/expiresAt');
  assert.deepEqual(invalidExpiry, {
    code: 'schema_invalid',
    rule: 'json_schema.format',
    path: '/nodes/3/expiresAt',
    nodeIds: ['evidence.checkout'],
    message: '/nodes/3/expiresAt must match format "dev-flow-utc-date-time"',
  });
});

test('runtime event references require a resolver and validate missing/schema/id/graph/hash integrity', async () => {
  const graph = await fixture('valid-master');
  const rawEvent = {
    schemaVersion: '1.0.0',
    id: 'event.checkout',
    graphId: graph.id,
    eventType: 'transition',
    occurredAt: '2026-07-24T09:30:00.000Z',
    actorId: 'maker.checkout',
    subjectIds: ['task.checkout'],
    payload: { from: 'planned', to: 'ready' },
  };
  graph.eventRefs = [{ id: rawEvent.id, ref: '.dev-flow/runtime/test/event.checkout.json', hash: sha256(stableStringify(rawEvent)) }];

  const unresolved = await checkGraph(graph);
  assert.ok(codes(unresolved).includes('event_resolver_required'));
  const missing = await checkGraph(graph, { eventResolver: async () => undefined });
  assert.ok(codes(missing).includes('event_reference_missing'));
  const schemaInvalid = { ...rawEvent };
  delete schemaInvalid.payload;
  graph.eventRefs[0].hash = sha256(stableStringify(schemaInvalid));
  assert.ok(codes(await checkGraph(graph, { eventResolver: async () => schemaInvalid })).includes('event_schema_invalid'));

  const wrongId = { ...rawEvent, id: 'event.other' };
  graph.eventRefs[0].hash = sha256(stableStringify(wrongId));
  assert.ok(codes(await checkGraph(graph, { eventResolver: async () => wrongId })).includes('event_id_mismatch'));

  const wrongGraph = { ...rawEvent, graphId: 'master.other' };
  graph.eventRefs[0].hash = sha256(stableStringify(wrongGraph));
  assert.ok(codes(await checkGraph(graph, { eventResolver: async () => wrongGraph })).includes('event_graph_mismatch'));

  graph.eventRefs[0].hash = sha256(stableStringify(rawEvent));
  const mismatch = await checkGraph(graph, { eventResolver: async () => ({ ...rawEvent, actorId: 'other' }) });
  assert.ok(codes(mismatch).includes('event_hash_mismatch'));
  const valid = await checkGraph(graph, { eventResolver: async () => rawEvent });
  assert.ok(!codes(valid).some((code) => code.startsWith('event_')));
});

test('eventRef resolver rejects an Event with an impossible UTC occurredAt', async () => {
  const graph = await fixture('valid-master');
  const event = await contractFixture('invalid-event-timestamp');
  graph.eventRefs = [{ id: event.id, ref: '.dev-flow/runtime/test/event.contract.json', hash: sha256(stableStringify(event)) }];
  const result = await checkGraph(graph, { eventResolver: async () => event });
  assert.ok(result.findings.some(
    (finding) => finding.code === 'event_schema_invalid'
      && finding.path === '/eventRefs/0/occurredAt'
      && finding.rule === 'events.schema.format',
  ));
});

test('findings are stable-sorted with deterministic fields and node IDs', async () => {
  const graph = await fixture('valid-master');
  graph.nodes.find((node) => node.type === 'Gate').prerequisiteIds = [];
  graph.edges.push({ id: 'edge.missing', type: 'control', from: 'missing.z', to: 'missing.a' });
  const first = (await checkGraph(graph)).findings;
  const second = (await checkGraph(clone(graph))).findings;
  assert.deepEqual(second, first);
  const codeUnitSort = (left, right) => {
    const leftKey = stableStringify(left);
    const rightKey = stableStringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };
  assert.deepEqual([...first].sort(codeUnitSort), first);
});

test('finding order uses locale-independent UTF-16 code-unit comparison', async () => {
  const graph = await fixture('valid-master');
  graph.edges.push(
    { id: 'edge.a', type: 'relates_to', from: 'missing.a', to: 'req.checkout' },
    { id: 'edge.A', type: 'relates_to', from: 'missing.A', to: 'req.checkout' },
  );
  const missingMessages = (await checkGraph(graph)).findings
    .filter((finding) => finding.code === 'missing_reference')
    .map((finding) => finding.message);
  assert.deepEqual(missingMessages, [
    'Edge edge.A references missing node missing.A',
    'Edge edge.a references missing node missing.a',
  ]);
});
