import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { EXIT_CODES } from './constants.mjs';
import { WorkflowBlockedError, finding } from './errors.mjs';
import { validateEventSchema } from './schema.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) || typeof value === 'string' ? value : stableStringify(value);
  return createHash('sha256').update(input).digest('hex');
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeTempFile(destination, value) {
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  let created = false;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(`${stableStringify(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
      handle = undefined;
    }
    return temporaryPath;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created) await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function atomicWriteJson(destination, value) {
  const temporaryPath = await writeTempFile(destination, value);
  try {
    await rename(temporaryPath, destination);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function createJsonExclusive(destination, value) {
  const temporaryPath = await writeTempFile(destination, value);
  try {
    await link(temporaryPath, destination);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  await unlink(temporaryPath);
}

export class GraphValidationError extends Error {
  constructor(findings, message = 'Graph validation failed') {
    super(message);
    this.name = 'GraphValidationError';
    this.code = 'GRAPH_VALIDATION_FAILED';
    this.exitCode = EXIT_CODES.VALIDATION;
    this.findings = findings;
  }
}

export async function writeGraphFile(destination, graph, options = {}) {
  if (graph.authority?.mode === 'legacy') {
    throw new WorkflowBlockedError('legacy_no_formal_graph', [finding(
      'legacy_no_formal_graph',
      'authority.legacy_markdown_writer',
      '/authority/mode',
      [],
      'Legacy authority has no formal Graph file to write',
    )]);
  }
  if (graph.authority?.mode === 'shadow' && !options.exclusive) {
    const error = new WorkflowBlockedError('shadow_read_only', [finding(
      'shadow_read_only',
      'authority.shadow_snapshot_create_only',
      '/authority/mode',
      [],
      'Shadow Graph is read-only; update its Markdown projection and create a new snapshot',
    )]);
    error.route = {
      classification: 'shadow_read_only',
      owner: 'master',
      action: 'update_shadow_projection_and_snapshot',
    };
    throw error;
  }
  const { checkGraph } = await import('./validate.mjs');
  const result = await checkGraph(graph, {
    eventResolver: options.eventResolver,
    now: options.now,
  });
  if (!result.valid) throw new GraphValidationError(result.findings);
  if (graph.authority?.mode === 'shadow') {
    const { checkShadowDrift } = await import('./compat.mjs');
    const drift = await checkShadowDrift(graph, {
      sourceRoot: options.sourceRoot ?? process.cwd(),
    });
    if (drift.length > 0) {
      const error = new WorkflowBlockedError(
        'shadow_drift',
        drift,
        'Shadow snapshot differs from its current Markdown authority',
      );
      error.route = {
        classification: 'shadow_drift',
        owner: 'master',
        action: 'update_shadow_projection_and_snapshot',
      };
      throw error;
    }
  }
  if (options.exclusive) return createJsonExclusive(destination, graph);
  return atomicWriteJson(destination, graph);
}

function eventFileName(eventId) {
  return `${encodeURIComponent(eventId)}.json`;
}

export async function writeRuntimeEvent(runtimeDirectory, event, options = {}) {
  const validation = validateEventSchema(event);
  if (!validation.valid) {
    const findings = validation.errors.map((error) => ({
      code: 'schema_invalid',
      rule: `json_schema.${error.keyword}`,
      path: error.instancePath || '/',
      nodeIds: [],
      message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
    }));
    throw new GraphValidationError(findings, 'Runtime event validation failed');
  }
  const destination = path.join(runtimeDirectory, eventFileName(event.id));
  await createJsonExclusive(destination, event);
  const ref = options.referenceRoot
    ? path.relative(options.referenceRoot, destination).split(path.sep).join('/')
    : destination;
  return { id: event.id, ref, hash: sha256(stableStringify(event)) };
}

export function createEventResolver(runtimeDirectory, options = {}) {
  return async (eventRef) => {
    const referencedPath = eventRef.ref
      ? (path.isAbsolute(eventRef.ref)
        ? eventRef.ref
        : path.resolve(options.referenceRoot ?? process.cwd(), eventRef.ref))
      : path.join(runtimeDirectory, eventFileName(eventRef.id));
    try {
      return await readJson(referencedPath);
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
}
