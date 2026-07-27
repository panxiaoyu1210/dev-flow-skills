export const SCHEMA_VERSION = '1.0.0';

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INTERNAL_OR_IO: 1,
  VALIDATION: 2,
  BLOCKED: 3,
});

export const GRAPH_KINDS = Object.freeze({
  MASTER: 'master',
  LOOP: 'loop',
});

export const MASTER_NODE_TYPES = Object.freeze([
  'Requirement',
  'Task',
  'Test',
  'Gate',
  'Evidence',
  'Git',
  'Failure',
]);

export const LOOP_NODE_TYPES = Object.freeze([
  'Goal',
  'Baseline',
  'Phase',
  'Envelope',
  'Budget',
  'Eval',
]);

export const DECLARABLE_ACYCLIC_EDGE_TYPES = Object.freeze(['depends_on', 'control']);

export const AUTHORITY_MODES = Object.freeze({
  legacy: Object.freeze({
    mode: 'legacy',
    sourceOfTruth: 'markdown',
    syncDirection: 'none',
    graphMutationAllowed: false,
    markdownViewReadableAsAuthority: true,
  }),
  shadow: Object.freeze({
    mode: 'shadow',
    sourceOfTruth: 'markdown',
    syncDirection: 'markdown_to_graph',
    graphMutationAllowed: false,
    markdownViewReadableAsAuthority: true,
  }),
  graph: Object.freeze({
    mode: 'graph',
    sourceOfTruth: 'graph',
    syncDirection: 'graph_to_markdown_view',
    graphMutationAllowed: true,
    markdownViewReadableAsAuthority: false,
  }),
});

const schemaBase = 'https://dev-flow.dev/schemas/v1';

export const SCHEMA_IDS = Object.freeze({
  graph: `${schemaBase}/graph.schema.json`,
  node: `${schemaBase}/node.schema.json`,
  edge: `${schemaBase}/edge.schema.json`,
  event: `${schemaBase}/event.schema.json`,
  context: `${schemaBase}/context.schema.json`,
  handoffReceipt: `${schemaBase}/handoff-receipt.schema.json`,
  masterGraph: `${schemaBase}/master-graph.schema.json`,
  loopGraph: `${schemaBase}/loop-graph.schema.json`,
  phaseHandoff: `${schemaBase}/phase-handoff.schema.json`,
  phaseResult: `${schemaBase}/phase-result.schema.json`,
});
