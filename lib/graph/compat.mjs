import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { EXIT_CODES } from './constants.mjs';
import { finding, sortFindings, codeUnitCompare } from './errors.mjs';
import { sha256, stableStringify } from './io.mjs';
import { canonicalizeGraphProjection } from './render.mjs';

export class ShadowProjectionError extends Error {
  constructor(code, message, pathName = '/authority/markdownSources') {
    super(message);
    this.name = 'ShadowProjectionError';
    this.code = code;
    this.exitCode = EXIT_CODES.VALIDATION;
    this.findings = [finding(code, `authority.${code}`, pathName, [], message)];
  }
}

export function legacyFallback() {
  return {
    authorityMode: 'legacy',
    sourceOfTruth: 'markdown',
    owner: 'dev-flow-master',
    action: 'continue_markdown_workflow',
    eligibleTasks: [],
    blockedTasks: [],
    eligiblePhases: [],
    blockedPhases: [],
    blocked: false,
  };
}

function localRefPath(ref, sourceRoot) {
  if (!ref || /^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return undefined;
  return path.isAbsolute(ref) ? ref : path.resolve(sourceRoot, ref);
}

function parseProjection(content, ref) {
  const projections = [];
  const pattern = /```dev-flow-graph\s*\r?\n([\s\S]*?)\r?\n```/g;
  for (const match of content.matchAll(pattern)) {
    let value;
    try {
      value = JSON.parse(match[1]);
    } catch (error) {
      throw new ShadowProjectionError(
        'shadow_projection_invalid',
        `Invalid dev-flow-graph JSON projection in ${ref}: ${error.message}`,
      );
    }
    projections.push(value);
  }
  if (projections.length > 1) throw new ShadowProjectionError(
    'shadow_projection_ambiguous',
    `Shadow Markdown source ${ref} contains more than one dev-flow-graph projection`,
  );
  return projections;
}

function normalizeProjection(projections) {
  const result = { nodes: [], edges: [], permissions: [], handoffReceipts: [] };
  for (const projection of projections) {
    if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
      throw new ShadowProjectionError(
        'shadow_projection_invalid',
        'Shadow projection must be a JSON object governed by the projection schema',
      );
    }
    const unknownKeys = Object.keys(projection).filter((key) => !Object.hasOwn(result, key));
    if (unknownKeys.length > 0) throw new ShadowProjectionError(
      'shadow_projection_invalid',
      `Shadow projection contains unsupported fields: ${unknownKeys.sort(codeUnitCompare).join(', ')}`,
    );
    for (const collection of Object.keys(result)) {
      if (projection[collection] === undefined) continue;
      if (!Array.isArray(projection[collection])) {
        throw new ShadowProjectionError(
          'shadow_projection_invalid',
          `Shadow projection ${collection} must be an array`,
        );
      }
      result[collection].push(...projection[collection]);
    }
  }
  return canonicalizeGraphProjection(result);
}

export async function readMarkdownProjection(markdownRefs, options = {}) {
  const sourceRoot = options.sourceRoot ?? process.cwd();
  const sources = [];
  const projections = [];
  const declaredCollections = new Set();
  for (const ref of [...markdownRefs].sort(codeUnitCompare)) {
    const sourcePath = localRefPath(ref, sourceRoot);
    if (!sourcePath) throw new TypeError(`Markdown source must be a local path: ${ref}`);
    const content = await readFile(sourcePath, 'utf8');
    const sourceProjections = parseProjection(content, ref);
    const semanticProjection = normalizeProjection(sourceProjections);
    for (const projection of sourceProjections) {
      for (const collection of Object.keys(projection)) declaredCollections.add(collection);
    }
    sources.push({ ref, hash: sha256(stableStringify(semanticProjection)) });
    projections.push(...sourceProjections);
  }
  if (projections.length === 0) throw new ShadowProjectionError(
    'shadow_projection_missing',
    'Shadow mode requires at least one fenced dev-flow-graph JSON projection across its Markdown sources',
  );
  return {
    markdownSources: sources,
    projection: normalizeProjection(projections),
    declaredCollections: [...declaredCollections].sort(codeUnitCompare),
  };
}

export async function checkShadowDrift(graph, options = {}) {
  if (graph.authority?.mode !== 'shadow') return [];
  const findings = [];
  let current;
  try {
    current = await readMarkdownProjection(
      graph.authority.markdownSources?.map((source) => source.ref) ?? [],
      options,
    );
  } catch (error) {
    if (error instanceof ShadowProjectionError) return error.findings;
    return [finding(
      'shadow_drift',
      'authority.shadow_source_readable',
      '/authority/markdownSources',
      [],
      error.message,
    )];
  }
  for (let index = 0; index < graph.authority.markdownSources.length; index += 1) {
    const expected = graph.authority.markdownSources[index];
    const actual = current.markdownSources.find((source) => source.ref === expected.ref);
    if (!actual || actual.hash !== expected.hash) findings.push(finding(
      'shadow_drift',
      'authority.shadow_hash_matches',
      `/authority/markdownSources/${index}/hash`,
      [],
      `Shadow snapshot differs from Markdown source ${expected.ref}`,
    ));
  }
  const persistedProjection = canonicalizeGraphProjection({
    nodes: graph.nodes,
    edges: graph.edges,
    permissions: graph.permissions,
    ...(graph.graphKind === 'master' ? { handoffReceipts: graph.handoffReceipts } : {}),
  });
  const currentProjection = graph.graphKind === 'master'
    ? current.projection
    : canonicalizeGraphProjection({
      nodes: current.projection.nodes,
      edges: current.projection.edges,
      permissions: current.projection.permissions,
    });
  if (stableStringify(currentProjection) !== stableStringify(persistedProjection)) {
    findings.push(finding(
      'shadow_drift',
      'authority.shadow_projection_matches',
      '/',
      [],
      'Shadow Graph structure differs from its Markdown projection',
    ));
  }
  return sortFindings(findings);
}
