import { access } from 'node:fs/promises';
import path from 'node:path';

import { AUTHORITY_MODES, EXIT_CODES, GRAPH_KINDS, SCHEMA_IDS, SCHEMA_VERSION } from './constants.mjs';
import {
  ShadowProjectionError,
  checkShadowDrift,
  legacyFallback,
  readMarkdownProjection,
} from './compat.mjs';
import { buildMinimalContext } from './context.mjs';
import { WorkflowBlockedError, finding, sortFindings } from './errors.mjs';
import { IMPACT_KINDS, applyImpact, computeImpact } from './impact.mjs';
import {
  GraphValidationError,
  createEventResolver,
  readJson,
  writeGraphFile,
} from './io.mjs';
import { queryNext } from './next.mjs';
import { writeGraphView } from './render.mjs';
import { commitTransition } from './transition.mjs';
import { checkGraph } from './validate.mjs';

function parseArguments(items) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith('--')) {
      positional.push(item);
      continue;
    }
    const separator = item.indexOf('=');
    if (separator !== -1) {
      const name = item.slice(2, separator);
      const value = item.slice(separator + 1);
      const previous = flags.get(name);
      flags.set(name, previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value]);
      continue;
    }
    const name = item.slice(2);
    const next = items[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      const previous = flags.get(name);
      flags.set(name, previous === undefined ? next : [...(Array.isArray(previous) ? previous : [previous]), next]);
      index += 1;
    } else flags.set(name, true);
  }
  return { positional, flags };
}

class CliValidationError extends Error {
  constructor(message, pathName = '/') {
    super(message);
    this.name = 'CliValidationError';
    this.code = 'cli_syntax_invalid';
    this.exitCode = EXIT_CODES.VALIDATION;
    this.findings = [finding('cli_syntax_invalid', 'cli.syntax', pathName, [], message)];
  }
}

function flagString(flags, name, required = false) {
  const value = flags.get(name);
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value)) throw new CliValidationError(`--${name} may be specified once`, `/flags/${name}`);
  if (required) throw new CliValidationError(`--${name} requires a value`, `/flags/${name}`);
  return undefined;
}

function flagStrings(flags, name) {
  const value = flags.get(name);
  if (value === undefined) return [];
  if (value === true) throw new CliValidationError(`--${name} requires a value`, `/flags/${name}`);
  return Array.isArray(value) ? value : [value];
}

function graphHelp() {
  return `Dev Flow Graph Control Kernel

Usage:
  dev-flow graph init --graph PATH --type master|loop --mode legacy|shadow|graph [--topic REF] [--markdown PATH ...] [--view PATH] [--json]
  dev-flow graph check --graph PATH [--source-root PATH] [--runtime PATH] [--run-id ID] [--json]
  dev-flow graph impact --graph PATH --kind requirement|artifact|file|task --source VALUE [--apply] [--source-root PATH] [--runtime PATH] [--run-id ID] [--view PATH] [--json]
  dev-flow graph next --graph PATH [--source-root PATH] [--runtime PATH] [--run-id ID] [--json]
  dev-flow graph context --graph PATH [--node ID] [--source-root PATH] [--runtime PATH] [--run-id ID] [--json]
  dev-flow graph transition --graph PATH --node ID --to STATUS --actor ID [--runtime PATH] [--run-id ID] [--view PATH] [--event-id ID] [--occurred-at UTC] [--capability-exception REASON] [--json]

Commands:
  init        Initialize an isolated Master or Loop Graph
  check       Validate schema, semantics, events, and Shadow drift
  impact      Preview or atomically apply typed stale propagation
  next        Return the next owner/action, stable targets/blockers, and compatibility work lists
  context     Build a schema-valid minimal context package
  transition Atomically record and apply a permitted state transition

Authority notes:
  legacy init returns compatibility mode and creates no Graph file.
  shadow init requires --markdown sources whose set contains at least one fenced dev-flow-graph JSON projection.
  each Shadow source may contain at most one projection; missing, invalid, or ambiguous projections are validation errors.
  Shadow refresh creates a new one-way snapshot target; init never overwrites or merges an existing target.
  graph init writes Graph authority and a generated Markdown view.
  init refuses an existing Graph target with exit 1.

Routing notes:
  empty Master and Loop Graphs route to definition work, never acceptance or completion.
  unknown_impact is always a workflow block, including explicit impact when the Graph is absent.
  Legacy compatibility remains available when the workflow does not invoke Graph impact.

Exit codes: 0 success, 1 I/O/internal, 2 validation/syntax, 3 workflow blocked.
`;
}

function printSuccess(io, command, data, json) {
  if (json) io.stdout(`${JSON.stringify({ ok: true, command, data })}\n`);
  else io.stdout(`${command}: success\n${JSON.stringify(data, null, 2)}\n`);
}

function normalizeError(error) {
  let exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : EXIT_CODES.INTERNAL_OR_IO;
  let findings = error?.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    const code = error?.code === 'EEXIST' ? 'graph_exists' : error?.code ?? 'internal_error';
    findings = [finding(
      String(code).toLowerCase(),
      error?.code === 'EEXIST' ? 'io.create_exclusive' : 'cli.operation',
      '/',
      [],
      error instanceof Error ? error.message : String(error),
    )];
    if (error instanceof TypeError) exitCode = EXIT_CODES.INTERNAL_OR_IO;
  }
  findings = sortFindings(findings);
  const first = findings[0];
  return {
    exitCode,
    error: {
      code: String(error?.code === 'EEXIST' ? 'graph_exists' : error?.code ?? first.code).toLowerCase(),
      rule: first.rule,
      path: first.path,
      nodeIds: first.nodeIds,
      message: error instanceof Error ? error.message : first.message,
      findings,
    },
  };
}

function printFailure(io, command, error, json) {
  const normalized = normalizeError(error);
  if (json) io.stdout(`${JSON.stringify({ ok: false, command, error: normalized.error })}\n`);
  else {
    io.stderr(`${command}: ${normalized.error.message}\n`);
    for (const item of normalized.error.findings) io.stderr(`- ${item.code}: ${item.message}\n`);
  }
  return normalized.exitCode;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function graphPathFrom(flags, cwd) {
  return path.resolve(cwd, flagString(flags, 'graph', true));
}

function defaultViewPath(graphPath) {
  return graphPath.endsWith('.json') ? `${graphPath.slice(0, -5)}.md` : `${graphPath}.md`;
}

function runtimeDirectory(flags, cwd, graph) {
  const explicit = flagString(flags, 'runtime');
  if (explicit) return path.resolve(cwd, explicit);
  const runId = flagString(flags, 'run-id') ?? graph?.id ?? 'graph-check';
  return path.resolve(cwd, '.dev-flow', 'runtime', runId);
}

async function readExistingGraph(flags, cwd) {
  const graphPath = graphPathFrom(flags, cwd);
  if (!await exists(graphPath)) return { graphPath, graph: undefined };
  try {
    return { graphPath, graph: await readJson(graphPath) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const validationError = new GraphValidationError([finding(
      'graph_json_invalid',
      'json.parse',
      '/',
      [],
      `Graph JSON is malformed: ${error.message}`,
    )], 'Graph JSON is malformed');
    validationError.code = 'graph_json_invalid';
    throw validationError;
  }
}

async function assertValidLoadedGraph(graph, flags, cwd) {
  const result = await checkGraph(graph, {
    eventResolver: createEventResolver(runtimeDirectory(flags, cwd, graph), { referenceRoot: cwd }),
  });
  if (!result.valid) throw new GraphValidationError(result.findings);
}

function assertNoShadowDrift(findings) {
  if (findings.length === 0) return;
  const projectionFinding = findings.find((item) => item.code.startsWith('shadow_projection_'));
  if (projectionFinding) {
    const error = new ShadowProjectionError(
      projectionFinding.code,
      projectionFinding.message,
      projectionFinding.path,
    );
    error.findings = findings;
    throw error;
  }
  throw new GraphValidationError(findings);
}

function initializedGraph(type, authority, topicRef, projection = {}) {
  if (!Object.values(GRAPH_KINDS).includes(type)) throw new CliValidationError('--type must be master or loop', '/flags/type');
  return {
    $schema: type === 'master' ? SCHEMA_IDS.masterGraph : SCHEMA_IDS.loopGraph,
    schemaVersion: SCHEMA_VERSION,
    graphKind: type,
    id: `${type}.${path.basename(topicRef).replace(/[^A-Za-z0-9._:/-]/g, '-') || 'graph'}`,
    topicRef,
    authority,
    revision: 0,
    acyclicEdgeTypes: ['depends_on', 'control'],
    nodes: projection.nodes ?? [], edges: projection.edges ?? [], permissions: projection.permissions ?? [],
    ...(type === 'master' ? { handoffReceipts: projection.handoffReceipts ?? [] } : {}),
    eventRefs: [],
  };
}

async function initCommand(flags, cwd) {
  const graphPath = graphPathFrom(flags, cwd);
  const type = flagString(flags, 'type', true);
  const mode = flagString(flags, 'mode', true);
  const topicRef = flagString(flags, 'topic') ?? path.dirname(graphPath);
  if (!Object.hasOwn(AUTHORITY_MODES, mode)) throw new CliValidationError('--mode must be legacy, shadow, or graph', '/flags/mode');
  if (mode === 'legacy') return { ...legacyFallback(), graphPath: undefined };
  let authority = AUTHORITY_MODES[mode];
  let projection = {};
  if (mode === 'shadow') {
    const markdownRefs = flagStrings(flags, 'markdown');
    if (markdownRefs.length === 0) throw new CliValidationError('Shadow init requires at least one --markdown PATH', '/flags/markdown');
    const snapshot = await readMarkdownProjection(markdownRefs, { sourceRoot: cwd });
    if (type === 'loop' && snapshot.declaredCollections.includes('handoffReceipts')) {
      throw new ShadowProjectionError(
        'shadow_projection_invalid',
        'Loop Shadow projection cannot declare Master handoffReceipts',
      );
    }
    authority = { ...AUTHORITY_MODES.shadow, markdownSources: snapshot.markdownSources };
    projection = snapshot.projection;
  }
  const graph = initializedGraph(type, authority, topicRef, projection);
  await writeGraphFile(graphPath, graph, { exclusive: true, sourceRoot: cwd });
  const viewPath = path.resolve(cwd, flagString(flags, 'view') ?? defaultViewPath(graphPath));
  if (mode === 'graph') await writeGraphView(viewPath, graph);
  return { graphPath, viewPath: mode === 'graph' ? viewPath : undefined, graph };
}

async function checkCommand(flags, cwd) {
  const { graphPath, graph } = await readExistingGraph(flags, cwd);
  if (!graph) return legacyFallback();
  if (graph.authority?.mode === 'legacy') return legacyFallback();
  const runtime = runtimeDirectory(flags, cwd, graph);
  const result = await checkGraph(graph, { eventResolver: createEventResolver(runtime, { referenceRoot: cwd }) });
  if (!result.valid) throw new GraphValidationError(result.findings);
  const drift = await checkShadowDrift(graph, { sourceRoot: flagString(flags, 'source-root') ?? cwd });
  assertNoShadowDrift(sortFindings(drift));
  return { graphPath, graphKind: graph.graphKind, authorityMode: graph.authority.mode, revision: graph.revision, valid: true };
}

async function impactCommand(flags, cwd) {
  const kind = flagString(flags, 'kind', true);
  if (!IMPACT_KINDS.includes(kind)) throw new CliValidationError(
    `--kind must be one of: ${IMPACT_KINDS.join(', ')}`,
    '/flags/kind',
  );
  const options = { kind, source: flagString(flags, 'source', true) };
  const { graphPath, graph } = await readExistingGraph(flags, cwd);
  if (!graph) {
    throw new WorkflowBlockedError('unknown_impact', [finding(
      'unknown_impact', 'impact.graph_required', '/', [],
      'Explicit Graph impact cannot model dependencies because the Graph is absent; use the Legacy workflow or create Graph authority',
    )]);
  }
  if (graph.authority?.mode === 'legacy') {
    throw new WorkflowBlockedError('unknown_impact', [finding(
      'unknown_impact', 'impact.graph_required', '/authority/mode', [],
      'Explicit Graph impact cannot model dependencies from residual Legacy authority; continue through the Legacy workflow',
    )]);
  }
  if (flags.has('apply') && graph.authority?.mode === 'shadow') throw new WorkflowBlockedError('authority_read_only', [finding(
    'authority_read_only', 'authority.shadow_read_only', '/authority/mode', [], 'Shadow Graph is a read-only Markdown snapshot',
  )]);
  await assertValidLoadedGraph(graph, flags, cwd);
  const drift = await checkShadowDrift(graph, { sourceRoot: flagString(flags, 'source-root') ?? cwd });
  assertNoShadowDrift(drift);
  if (!flags.has('apply')) {
    const result = computeImpact(graph, options);
    if (result.unknownImpact) throw new WorkflowBlockedError('unknown_impact', [finding(
      'unknown_impact', 'impact.conservative_route', '/', [], 'Impact includes an unmodelled dependency; conservative review is required',
    )]);
    return { ...result, applied: false };
  }
  const result = applyImpact(graph, options);
  if (result.unknownImpact) throw new WorkflowBlockedError('unknown_impact', [finding(
    'unknown_impact', 'impact.conservative_route', '/', [], 'Unknown impact was not applied',
  )]);
  const runtime = runtimeDirectory(flags, cwd, graph);
  await writeGraphFile(graphPath, result.graph, { eventResolver: createEventResolver(runtime, { referenceRoot: cwd }) });
  const viewPath = path.resolve(cwd, flagString(flags, 'view') ?? defaultViewPath(graphPath));
  await writeGraphView(viewPath, result.graph);
  return { ...result, graph: undefined, graphPath, viewPath, revision: result.graph.revision };
}

async function nextCommand(flags, cwd) {
  const { graph, graphPath } = await readExistingGraph(flags, cwd);
  if (!graph) return legacyFallback();
  if (graph.authority?.mode === 'legacy') return legacyFallback();
  await assertValidLoadedGraph(graph, flags, cwd);
  const drift = await checkShadowDrift(graph, { sourceRoot: flagString(flags, 'source-root') ?? cwd });
  assertNoShadowDrift(drift);
  const result = { authorityMode: graph.authority.mode, ...queryNext(graph) };
  if (result.blocked) throw new WorkflowBlockedError('workflow_blocked', result.blockers.map((blocker) => finding(
    blocker.code,
    'next.structured_blocker',
    '/nodes',
    [...new Set([blocker.nodeId, ...(blocker.relatedNodeIds ?? [])])].filter(Boolean),
    `${blocker.code}${blocker.refs.length > 0 ? ` (${blocker.refs.join(', ')})` : ''}`,
  )), `No legal action in ${graphPath}`);
  return result;
}

async function contextCommand(flags, cwd) {
  const { graph } = await readExistingGraph(flags, cwd);
  if (!graph) return { ...legacyFallback(), schemaVersion: SCHEMA_VERSION };
  if (graph.authority?.mode === 'legacy') return legacyFallback();
  await assertValidLoadedGraph(graph, flags, cwd);
  const drift = await checkShadowDrift(graph, { sourceRoot: flagString(flags, 'source-root') ?? cwd });
  assertNoShadowDrift(drift);
  return buildMinimalContext(graph, { nodeId: flagString(flags, 'node') });
}

async function transitionCommand(flags, cwd) {
  const { graphPath, graph } = await readExistingGraph(flags, cwd);
  if (!graph) throw new WorkflowBlockedError('authority_read_only', [finding(
    'authority_read_only', 'authority.legacy_markdown_writer', '/', [], 'Legacy mode keeps Markdown authoritative',
  )]);
  await assertValidLoadedGraph(graph, flags, cwd);
  const viewPath = path.resolve(cwd, flagString(flags, 'view') ?? defaultViewPath(graphPath));
  const actorId = flagString(flags, 'actor', true);
  const nodeId = flagString(flags, 'node', true);
  const capabilityReason = flagString(flags, 'capability-exception');
  const result = await commitTransition({
    graph, graphPath, viewPath,
    runtimeDirectory: runtimeDirectory(flags, cwd, graph),
    nodeId,
    toStatus: flagString(flags, 'to', true),
    actorId,
    eventId: flagString(flags, 'event-id'),
    occurredAt: flagString(flags, 'occurred-at'),
    referenceRoot: cwd,
    ...(capabilityReason ? {
      capabilityException: {
        kind: 'capability_exception', actorId, action: 'transition', resourceRef: nodeId, reason: capabilityReason,
      },
    } : {}),
  });
  return { graphPath, viewPath, revision: result.graph.revision, nodeId, fromStatus: result.fromStatus, toStatus: result.toStatus, eventRef: result.eventRef };
}

export async function runGraphCli(items, options = {}) {
  const io = options.io ?? {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  const cwd = options.cwd ?? process.cwd();
  const { positional, flags } = parseArguments(items);
  const command = positional[0] ?? 'help';
  const json = flags.has('json');
  if (command === 'help' || command === '--help' || command === '-h') {
    io.stdout(graphHelp());
    return EXIT_CODES.SUCCESS;
  }
  try {
    const allowedFlags = {
      init: ['graph', 'type', 'mode', 'topic', 'markdown', 'view', 'json'],
      check: ['graph', 'source-root', 'runtime', 'run-id', 'json'],
      impact: ['graph', 'kind', 'source', 'apply', 'source-root', 'runtime', 'run-id', 'view', 'json'],
      next: ['graph', 'source-root', 'runtime', 'run-id', 'json'],
      context: ['graph', 'node', 'source-root', 'runtime', 'run-id', 'json'],
      transition: ['graph', 'node', 'to', 'actor', 'runtime', 'run-id', 'view', 'event-id', 'occurred-at', 'capability-exception', 'json'],
    };
    if (!Object.hasOwn(allowedFlags, command)) throw new CliValidationError(`Unknown graph command: ${command}`, '/command');
    if (positional.length !== 1) throw new CliValidationError('Unexpected positional argument', '/arguments');
    for (const name of flags.keys()) {
      if (!allowedFlags[command].includes(name)) throw new CliValidationError(`Unknown option --${name}`, `/flags/${name}`);
    }
    for (const name of ['json', 'apply']) {
      if (flags.has(name) && flags.get(name) !== true) throw new CliValidationError(`--${name} does not take a value`, `/flags/${name}`);
    }
    flagString(flags, 'graph', true);
    let data;
    if (command === 'init') data = await initCommand(flags, cwd);
    else if (command === 'check') data = await checkCommand(flags, cwd);
    else if (command === 'impact') data = await impactCommand(flags, cwd);
    else if (command === 'next') data = await nextCommand(flags, cwd);
    else if (command === 'context') data = await contextCommand(flags, cwd);
    else if (command === 'transition') data = await transitionCommand(flags, cwd);
    printSuccess(io, `graph ${command}`, data, json);
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    return printFailure(io, `graph ${command}`, error, json);
  }
}

export { graphHelp };
