#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageRoot, 'bin', 'dev-flow.mjs');
const docsRoot = path.join(packageRoot, 'docs');
const retiredIdentifier = ['super', 'power'].join('');
const workspaceMode = process.argv.slice(2).includes('--workspace');
const focusArgument = process.argv.slice(2).find((argument) => argument.startsWith('--focus='));
const focusName = focusArgument?.slice('--focus='.length);
const fixturePrefix = `retired-guard-${process.pid}-`;
const expectedPackArguments = ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=silent'];
const failures = [];
let passed = 0;

function combinedOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function diagnosticSummary(result) {
  const output = combinedOutput(result);
  const lines = output.split('\n').filter((line) => (
    line.includes('✗')
    || line.includes('Not ready')
    || line.toLowerCase().includes('retired workflow')
    || line.toLowerCase().includes('missing:')
  ));
  return (lines.length > 0 ? lines : output.split('\n').slice(-12)).join('\n').slice(0, 4000);
}

function runDoctor({ env = process.env, workspace = workspaceMode } = {}) {
  const doctorArguments = [cliPath, 'doctor', '--target', '.'];
  if (workspace) {
    doctorArguments.push('--workspace');
  }
  return spawnSync(process.execPath, doctorArguments, {
    cwd: packageRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function assertDoctorPasses(context, options = {}) {
  const result = runDoctor(options);
  assert.equal(
    result.status,
    0,
    `${context}: doctor exited ${String(result.status)}\n${diagnosticSummary(result)}`,
  );
  assert.equal(result.error, undefined, `${context}: doctor spawn error: ${String(result.error)}`);
}

function assertDoctorRejects({ context, expectedDiagnostics, env = process.env, workspace = workspaceMode }) {
  const result = runDoctor({ env, workspace });
  const output = combinedOutput(result);
  assert.equal(result.status, 1, `${context}: doctor exit was ${String(result.status)}, expected 1`);
  assert.equal(result.error, undefined, `${context}: doctor spawn error: ${String(result.error)}`);
  for (const diagnostic of expectedDiagnostics) {
    assert.ok(
      output.includes(diagnostic),
      `${context}: missing diagnostic ${JSON.stringify(diagnostic)}\n${diagnosticSummary(result)}`,
    );
  }
}

function runRealPack() {
  return spawnSync('npm', expectedPackArguments, {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseRealPackFiles(context) {
  const result = runRealPack();
  assert.equal(result.status, 0, `${context}: npm pack exited ${String(result.status)}\n${combinedOutput(result)}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed) && parsed.length === 1, `${context}: unexpected npm pack JSON shape`);
  assert.ok(Array.isArray(parsed[0].files), `${context}: npm pack JSON has no files array`);
  return parsed[0].files.map((entry) => entry.path);
}

function assertActuallyPacked(relativePath, context) {
  const files = parseRealPackFiles(context);
  assert.ok(files.includes(relativePath), `${context}: fixture absent from npm files[]: ${relativePath}`);
}

async function runTest(name, body) {
  if (focusName && !name.includes(focusName)) {
    return;
  }
  try {
    await body();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${formatError(error)}`);
  }
}

function formatError(error, depth = 0) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const nested = error instanceof AggregateError
    ? error.errors
    : error.cause
      ? [error.cause]
      : [];
  if (nested.length === 0 || depth >= 3) {
    return error.message;
  }
  return `${error.message}\n${nested.map((item) => `${'  '.repeat(depth + 1)}${formatError(item, depth + 1)}`).join('\n')}`;
}

async function exerciseWithCleanup({
  context,
  setup,
  exercise,
  cleanup,
  verifyCleanup,
  recovery = () => assertDoctorPasses(`${context} post-cleanup`),
}) {
  const errors = [];
  try {
    await setup();
    await exercise();
  } catch (error) {
    errors.push(new Error(`${context} exercise failed`, { cause: error }));
  } finally {
    try {
      await cleanup();
    } catch (error) {
      errors.push(new Error(`${context} cleanup failed`, { cause: error }));
    }
  }

  try {
    await verifyCleanup();
  } catch (error) {
    errors.push(new Error(`${context} cleanup verification failed`, { cause: error }));
  }

  try {
    await recovery();
  } catch (error) {
    errors.push(new Error(`${context} recovery doctor failed`, { cause: error }));
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, `${context}: ${errors.length} failure(s)`);
  }
}

async function runPackedFixtureCase({ name, relativePath, bytes }) {
  const absolutePath = path.join(packageRoot, relativePath);
  await runTest(name, async () => {
    assert.equal(existsSync(absolutePath), false, `${name}: fixture already exists`);
    await exerciseWithCleanup({
      context: name,
      setup: async () => {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, bytes);
      },
      exercise: async () => {
        assertActuallyPacked(relativePath, name);
        assertDoctorRejects({
          context: name,
          expectedDiagnostics: [
            'retired workflow package scan: forbidden identifier bytes',
            relativePath,
          ],
        });
      },
      cleanup: async () => {
        await rm(absolutePath, { force: true });
      },
      verifyCleanup: async () => {
        assert.equal(existsSync(absolutePath), false, `${name}: fixture residue remains`);
      },
    });
  });
}

function packJson(paths) {
  return JSON.stringify([{
    files: paths.map((filePath) => ({ path: filePath, size: 0, mode: 0o644 })),
  }]);
}

async function createNpmShim({ stdout = '', exitCode = 0 }) {
  const shimRoot = await mkdtemp(path.join(tmpdir(), 'dev-flow-pack-shim-'));
  const shimPath = path.join(shimRoot, 'npm');
  const shimSource = `#!/bin/sh
if [ "$*" != "pack --dry-run --json --ignore-scripts --loglevel=silent" ]; then
  printf '%s\\n' 'unexpected npm arguments' >&2
  exit 64
fi
printf '%s' "$DEV_FLOW_PACK_STDOUT"
exit "$DEV_FLOW_PACK_EXIT"
`;
  await writeFile(shimPath, shimSource, { mode: 0o755 });
  return {
    root: shimRoot,
    env: {
      ...process.env,
      PATH: `${shimRoot}${path.delimiter}${process.env.PATH ?? ''}`,
      DEV_FLOW_PACK_STDOUT: stdout,
      DEV_FLOW_PACK_EXIT: String(exitCode),
    },
  };
}

async function runShimCase({ name, stdout, exitCode, expectedDiagnostics, setup = async () => {}, cleanup = async () => {}, verifyCleanup = async () => {} }) {
  await runTest(name, async () => {
    let shim;
    await exerciseWithCleanup({
      context: name,
      setup: async () => {
        await setup();
        shim = await createNpmShim({ stdout, exitCode });
      },
      exercise: async () => {
        assertDoctorRejects({ context: name, expectedDiagnostics, env: shim.env });
      },
      cleanup: async () => {
        if (shim?.root) {
          await rm(shim.root, { recursive: true, force: true });
        }
        await cleanup();
      },
      verifyCleanup: async () => {
        if (shim?.root) {
          assert.equal(existsSync(shim.root), false, `${name}: npm shim residue remains`);
        }
        await verifyCleanup();
      },
    });
  });
}

function parseRealWorkspaceFiles(context) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: packageRoot,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${context}: git ls-files exited ${String(result.status)}`);
  assert.ok(Buffer.isBuffer(result.stdout) && result.stdout.at(-1) === 0, `${context}: invalid git file list`);
  const paths = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout).split('\0');
  paths.pop();
  return paths;
}

async function runWorkspaceOnlyFixtureCase({ name, relativePath, bytes }) {
  const absolutePath = path.join(packageRoot, relativePath);
  await runTest(name, async () => {
    assert.equal(existsSync(absolutePath), false, `${name}: fixture already exists`);
    await exerciseWithCleanup({
      context: name,
      setup: async () => {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, bytes);
      },
      exercise: async () => {
        assert.equal(parseRealPackFiles(name).includes(relativePath), false, `${name}: fixture unexpectedly published`);
        assert.ok(parseRealWorkspaceFiles(name).includes(relativePath), `${name}: fixture absent from git workspace set`);
        assertDoctorPasses(`${name} package-only doctor`, { workspace: false });
        assertDoctorRejects({
          context: `${name} workspace doctor`,
          workspace: true,
          expectedDiagnostics: [
            'retired workflow workspace scan: forbidden identifier bytes',
            relativePath,
          ],
        });
      },
      cleanup: async () => {
        await rm(absolutePath, { force: true });
      },
      verifyCleanup: async () => {
        assert.equal(existsSync(absolutePath), false, `${name}: fixture residue remains`);
      },
      recovery: async () => {
        assertDoctorPasses(`${name} package recovery`, { workspace: false });
        assertDoctorPasses(`${name} workspace recovery`, { workspace: true });
      },
    });
  });
}

async function createGitShim(mode) {
  const shimRoot = await mkdtemp(path.join(tmpdir(), 'dev-flow-git-shim-'));
  const shimPath = path.join(shimRoot, 'git');
  const shimSource = `#!/bin/sh
if [ "$*" != "ls-files --cached --others --exclude-standard -z" ]; then
  printf '%s\\n' 'unexpected git arguments' >&2
  exit 64
fi
case "$DEV_FLOW_GIT_MODE" in
  nonzero) exit 29 ;;
  empty) exit 0 ;;
  non-nul) printf '%s' 'package.json' ;;
  invalid-utf8) printf '\\377\\000' ;;
  *) exit 65 ;;
esac
`;
  await writeFile(shimPath, shimSource, { mode: 0o755 });
  return {
    root: shimRoot,
    env: {
      ...process.env,
      PATH: `${shimRoot}${path.delimiter}${process.env.PATH ?? ''}`,
      DEV_FLOW_GIT_MODE: mode,
    },
  };
}

async function runGitShimCase({ name, mode, expectedDiagnostics }) {
  await runTest(name, async () => {
    let shim;
    await exerciseWithCleanup({
      context: name,
      setup: async () => {
        shim = await createGitShim(mode);
      },
      exercise: async () => {
        assertDoctorRejects({
          context: name,
          env: shim.env,
          workspace: true,
          expectedDiagnostics,
        });
      },
      cleanup: async () => {
        if (shim?.root) {
          await rm(shim.root, { recursive: true, force: true });
        }
      },
      verifyCleanup: async () => {
        if (shim?.root) {
          assert.equal(existsSync(shim.root), false, `${name}: git shim residue remains`);
        }
      },
      recovery: async () => {
        assertDoctorPasses(`${name} workspace recovery`, { workspace: true });
      },
    });
  });
}

function replaceExactlyOnce(content, needle, replacement, context) {
  const first = content.indexOf(needle);
  assert.notEqual(first, -1, `${context}: semantic phrase not found`);
  assert.equal(content.indexOf(needle, first + needle.length), -1, `${context}: semantic phrase is not unique`);
  return `${content.slice(0, first)}${replacement}${content.slice(first + needle.length)}`;
}

async function runSemanticDeletionCase({ name, relativePath, phrase, replacement, expectedLabel }) {
  const sourcePath = path.join(packageRoot, 'skills', relativePath);
  const mirrorPath = path.join(packageRoot, '.opencode', 'skills', relativePath);
  let sourceBytes;
  let mirrorBytes;
  await runTest(name, async () => {
    await exerciseWithCleanup({
      context: name,
      setup: async () => {
        sourceBytes = await readFile(sourcePath);
        mirrorBytes = await readFile(mirrorPath);
        assert.deepEqual(sourceBytes, mirrorBytes, `${name}: source/mirror precondition mismatch`);
        const modified = replaceExactlyOnce(sourceBytes.toString('utf8'), phrase, replacement, name);
        await writeFile(sourcePath, modified);
        await writeFile(mirrorPath, modified);
      },
      exercise: async () => {
        assertDoctorRejects({ context: name, expectedDiagnostics: [expectedLabel] });
      },
      cleanup: async () => {
        if (sourceBytes) {
          await writeFile(sourcePath, sourceBytes);
        }
        if (mirrorBytes) {
          await writeFile(mirrorPath, mirrorBytes);
        }
      },
      verifyCleanup: async () => {
        assert.deepEqual(await readFile(sourcePath), sourceBytes, `${name}: source bytes not restored`);
        assert.deepEqual(await readFile(mirrorPath), mirrorBytes, `${name}: mirror bytes not restored`);
      },
    });
  });
}

async function assertSemanticRequiredConfiguration(groups) {
  await runTest('semantic guards configure every substantive required phrase', async () => {
    const cliSource = await readFile(cliPath, 'utf8');
    for (const group of groups) {
      const labelMarker = `label: '${group.label}'`;
      const start = cliSource.indexOf(labelMarker);
      assert.notEqual(start, -1, `semantic configuration missing label: ${group.label}`);
      const end = cliSource.indexOf('\n  },', start);
      assert.notEqual(end, -1, `semantic configuration block is unterminated: ${group.label}`);
      const block = cliSource.slice(start, end);
      for (const phrase of group.required) {
        assert.ok(block.includes(phrase), `${group.label}: production required list omits ${JSON.stringify(phrase)}`);
      }
    }
  });
}

function moveTableOfContentsHeading(content, heading, lineNumber, context) {
  const lines = content.split('\n');
  const currentIndex = lines.findIndex((line) => line === '## 目录');
  assert.notEqual(currentIndex, -1, `${context}: original TOC heading missing`);
  assert.equal(lines.indexOf('## 目录', currentIndex + 1), -1, `${context}: original TOC heading is not unique`);
  lines.splice(currentIndex, 1);
  lines.splice(lineNumber - 1, 0, heading);
  assert.equal(lines[lineNumber - 1], heading, `${context}: TOC heading not placed at line ${lineNumber}`);
  return lines.join('\n');
}

async function runTocBoundaryCase({ name, heading, lineNumber, shouldPass }) {
  const relativePath = 'dev-flow-master/references/capability-adapters.md';
  const sourcePath = path.join(packageRoot, 'skills', relativePath);
  const mirrorPath = path.join(packageRoot, '.opencode', 'skills', relativePath);
  let sourceBytes;
  let mirrorBytes;
  await runTest(name, async () => {
    await exerciseWithCleanup({
      context: name,
      setup: async () => {
        sourceBytes = await readFile(sourcePath);
        mirrorBytes = await readFile(mirrorPath);
        assert.deepEqual(sourceBytes, mirrorBytes, `${name}: source/mirror precondition mismatch`);
        const modified = moveTableOfContentsHeading(sourceBytes.toString('utf8'), heading, lineNumber, name);
        await writeFile(sourcePath, modified);
        await writeFile(mirrorPath, modified);
      },
      exercise: async () => {
        if (shouldPass) {
          assertDoctorPasses(name);
        } else {
          assertDoctorRejects({
            context: name,
            expectedDiagnostics: ['reference TOC: dev-flow-master/references/capability-adapters.md'],
          });
        }
      },
      cleanup: async () => {
        if (sourceBytes) {
          await writeFile(sourcePath, sourceBytes);
        }
        if (mirrorBytes) {
          await writeFile(mirrorPath, mirrorBytes);
        }
      },
      verifyCleanup: async () => {
        assert.deepEqual(await readFile(sourcePath), sourceBytes, `${name}: source bytes not restored`);
        assert.deepEqual(await readFile(mirrorPath), mirrorBytes, `${name}: mirror bytes not restored`);
      },
    });
  });
}

function mixedAsciiCase(value) {
  return [...value].map((character, index) => (
    index % 2 === 0 ? character.toUpperCase() : character.toLowerCase()
  )).join('');
}

await runTest('clean doctor baseline', async () => {
  assertDoctorPasses('clean baseline');
});

await runTest('help publishes workspace doctor mode', async () => {
  const result = spawnSync(process.execPath, [cliPath, 'help'], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `help exited ${String(result.status)}`);
  assert.ok(
    combinedOutput(result).includes('dev-flow doctor [--global|--target PATH] [--workspace]'),
    'help omits doctor --workspace',
  );
});

const formFixtures = [
  ['singular target bytes', retiredIdentifier],
  ['plural target bytes', `${retiredIdentifier}s`],
  ['mixed-case target bytes', mixedAsciiCase(retiredIdentifier)],
  ['namespace target bytes', `${retiredIdentifier}:test-driven-development`],
];

for (let index = 0; index < formFixtures.length; index += 1) {
  const [name, value] = formFixtures[index];
  await runPackedFixtureCase({
    name,
    relativePath: `docs/${fixturePrefix}form-${index}.txt`,
    bytes: Buffer.from(value, 'ascii'),
  });
}

const triggerActions = ['discover', 'load', 'route', 'invoke', 'recommend', 'required', 'optional', 'fallback'];
for (const action of triggerActions) {
  await runPackedFixtureCase({
    name: `no-trigger action: ${action}`,
    relativePath: `docs/${fixturePrefix}action-${action}.txt`,
    bytes: Buffer.from(`${action} ${retiredIdentifier}`, 'ascii'),
  });
}

await runPackedFixtureCase({
  name: 'unknown extension raw bytes',
  relativePath: `docs/${fixturePrefix}unknown.assetx`,
  bytes: Buffer.from(`prefix-${retiredIdentifier}-suffix`, 'ascii'),
});
await runPackedFixtureCase({
  name: 'extensionless raw bytes',
  relativePath: `docs/${fixturePrefix}extensionless`,
  bytes: Buffer.from(retiredIdentifier, 'ascii'),
});
await runPackedFixtureCase({
  name: 'binary NUL raw bytes',
  relativePath: `docs/${fixturePrefix}binary.bin`,
  bytes: Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(retiredIdentifier, 'ascii'), Buffer.from([0, 2])]),
});

await runWorkspaceOnlyFixtureCase({
  name: 'workspace-only OpenSpec raw bytes',
  relativePath: `openspec/changes/integrate-grill-trellis/${fixturePrefix}workspace-only.fixture`,
  bytes: Buffer.from(retiredIdentifier, 'ascii'),
});

await runShimCase({
  name: 'npm pack nonzero fails closed',
  stdout: '',
  exitCode: 23,
  expectedDiagnostics: ['retired workflow package scan: npm pack failed', 'exit 23'],
});
await runShimCase({
  name: 'npm pack invalid JSON fails closed',
  stdout: 'not-json',
  expectedDiagnostics: ['retired workflow package scan: invalid npm pack JSON'],
});
await runShimCase({
  name: 'npm pack invalid structure fails closed',
  stdout: JSON.stringify({ files: [] }),
  expectedDiagnostics: ['retired workflow package scan: invalid npm pack result structure'],
});
await runShimCase({
  name: 'npm pack empty files fails closed',
  stdout: JSON.stringify([{ files: [] }]),
  expectedDiagnostics: ['retired workflow package scan: npm pack files list is empty'],
});
await runShimCase({
  name: 'npm pack invalid file entry fails closed',
  stdout: JSON.stringify([{ files: [{ path: 42 }] }]),
  expectedDiagnostics: ['retired workflow package scan: invalid npm pack file entry'],
});

await runGitShimCase({
  name: 'git workspace listing nonzero fails closed',
  mode: 'nonzero',
  expectedDiagnostics: ['retired workflow workspace scan: git ls-files failed', 'exit 29'],
});
await runGitShimCase({
  name: 'git workspace listing empty stdout fails closed',
  mode: 'empty',
  expectedDiagnostics: ['retired workflow workspace scan: invalid or empty git file list'],
});
await runGitShimCase({
  name: 'git workspace listing without NUL fails closed',
  mode: 'non-nul',
  expectedDiagnostics: ['retired workflow workspace scan: invalid or empty git file list'],
});
await runGitShimCase({
  name: 'git workspace listing invalid UTF-8 fails closed',
  mode: 'invalid-utf8',
  expectedDiagnostics: ['retired workflow workspace scan: git file list is not valid UTF-8'],
});

const absoluteFaultPath = path.join(tmpdir(), `${fixturePrefix}absolute`);
await runShimCase({
  name: 'absolute pack path fails closed',
  stdout: packJson([absoluteFaultPath]),
  expectedDiagnostics: ['retired workflow package scan: absolute path is not allowed', absoluteFaultPath],
});
const win32AbsoluteFaultPath = `C:\\${fixturePrefix}absolute`;
await runShimCase({
  name: 'Win32 absolute pack path fails closed',
  stdout: packJson([win32AbsoluteFaultPath]),
  expectedDiagnostics: [
    'retired workflow package scan: absolute path is not allowed',
    JSON.stringify(win32AbsoluteFaultPath),
  ],
});
const parentFaultPath = `../${fixturePrefix}parent`;
await runShimCase({
  name: 'parent pack path escape fails closed',
  stdout: packJson([parentFaultPath]),
  expectedDiagnostics: ['retired workflow package scan: path escapes package root', parentFaultPath],
});
const missingRelativePath = `docs/${fixturePrefix}missing`;
await runShimCase({
  name: 'missing packed file fails closed',
  stdout: packJson([missingRelativePath]),
  expectedDiagnostics: ['retired workflow package scan: cannot resolve file', missingRelativePath],
});
await runShimCase({
  name: 'directory packed entry fails closed',
  stdout: packJson(['docs']),
  expectedDiagnostics: ['retired workflow package scan: not a regular file', 'docs'],
});

const unreadableRelativePath = `docs/${fixturePrefix}unreadable`;
const unreadablePath = path.join(packageRoot, unreadableRelativePath);
await runShimCase({
  name: 'unreadable packed file fails closed',
  stdout: packJson([unreadableRelativePath]),
  expectedDiagnostics: ['retired workflow package scan: cannot read file', unreadableRelativePath],
  setup: async () => {
    await writeFile(unreadablePath, 'neutral fixture');
    await chmod(unreadablePath, 0o000);
  },
  cleanup: async () => {
    if (existsSync(unreadablePath)) {
      await chmod(unreadablePath, 0o600);
    }
    await rm(unreadablePath, { force: true });
  },
  verifyCleanup: async () => {
    assert.equal(existsSync(unreadablePath), false, 'unreadable fixture residue remains');
  },
});

const symlinkRelativePath = `docs/${fixturePrefix}symlink`;
const symlinkPath = path.join(packageRoot, symlinkRelativePath);
let outsideRoot;
await runShimCase({
  name: 'symlink realpath escape fails closed',
  stdout: packJson([symlinkRelativePath]),
  expectedDiagnostics: ['retired workflow package scan: realpath escapes package root', symlinkRelativePath],
  setup: async () => {
    outsideRoot = await mkdtemp(path.join(tmpdir(), 'dev-flow-outside-'));
    const outsideFile = path.join(outsideRoot, 'neutral');
    await writeFile(outsideFile, 'neutral fixture');
    await symlink(outsideFile, symlinkPath);
  },
  cleanup: async () => {
    await rm(symlinkPath, { force: true });
    if (outsideRoot) {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  },
  verifyCleanup: async () => {
    assert.equal(existsSync(symlinkPath), false, 'symlink fixture residue remains');
    if (outsideRoot) {
      assert.equal(existsSync(outsideRoot), false, 'outside symlink fixture residue remains');
    }
  },
});

const semanticRequiredPhraseGroups = [
  {
    label: 'Grill-me clarification adapter contract',
    required: [
      'grill-me',
      'AVAILABLE',
      'UNAVAILABLE',
      'LOAD_FAILED',
      'DECLINED',
      '### 本地回退',
      '一次询问一个高价值问题。',
    ],
  },
  {
    label: 'Trellis capability adapter contract',
    required: [
      '.trellis/workflow.md',
      '`task_context`',
      '`spec_context`',
      '`workspace_memory`',
      '`injected_context`',
      '`check`',
      '一个分量失败不得覆盖其他分量',
      'check.detected',
      'check.executable_now',
      '不得枚举后执行 `.trellis/scripts/` 中的未知内容。',
    ],
  },
  {
    label: 'local root-cause contract',
    required: [
      '稳定复现并记录失败命令或步骤、退出码与输出摘要',
      '先收集证据，再提出可证伪假设并定位根因',
      'failing test first',
      'observed RED',
      'minimal GREEN',
      '相关检查和回归验证',
      '不可复现时停止修复',
      '不得猜测修复',
    ],
  },
  {
    label: 'local per-task TDD contract',
    required: [
      'failing test first',
      'observed RED',
      'minimal GREEN',
      'green-only refactor',
      'Each run records the command, `exit_code`, and `output_summary`.',
      '只有 OpenSpec 明确允许且用户批准的例外',
    ],
  },
  {
    label: 'fresh verification contract',
    required: [
      'rerun it in the current round',
      'read the complete result',
      'claim only the supported scope',
      '`claim_scope`',
      '`command_or_browser`',
      '`observed_at`',
      '`exit_code_or_result`',
      '`output_summary`',
      '`supported_conclusion`',
      'Historical logs, earlier green runs, and implementer reports are context, not proof.',
    ],
  },
];

await assertSemanticRequiredConfiguration(semanticRequiredPhraseGroups);

const semanticDeletionCases = [
  {
    name: 'Grill-me semantic deletion',
    relativePath: 'dev-flow-master/references/capability-adapters.md',
    phrase: '一次询问一个高价值问题。',
    replacement: '批量询问所有未决问题。',
    expectedLabel: 'Grill-me clarification adapter contract',
  },
  {
    name: 'Trellis semantic deletion',
    relativePath: 'dev-flow-master/references/capability-adapters.md',
    phrase: '一个分量失败不得覆盖其他分量。',
    replacement: '分量失败时统一终止适配。',
    expectedLabel: 'Trellis capability adapter contract',
  },
  {
    name: 'local root-cause semantic deletion',
    relativePath: 'dev-flow-debugging/SKILL.md',
    phrase: '先收集证据，再提出可证伪假设并定位根因。',
    replacement: '收集部分证据后直接修改。',
    expectedLabel: 'local root-cause contract',
  },
  {
    name: 'local per-task TDD semantic deletion',
    relativePath: 'dev-flow-execution/SKILL.md',
    phrase: 'Each run records the command, `exit_code`, and `output_summary`.',
    replacement: 'Each run may retain an informal summary.',
    expectedLabel: 'local per-task TDD contract',
  },
  {
    name: 'fresh verification semantic deletion',
    relativePath: 'dev-flow-acceptance/SKILL.md',
    phrase: 'rerun it in the current round',
    replacement: 'reuse the previous successful run',
    expectedLabel: 'fresh verification contract',
  },
];

for (const semanticCase of semanticDeletionCases) {
  await runSemanticDeletionCase(semanticCase);
}

for (const [language, heading] of [
  ['English', '## Table of Contents'],
  ['Chinese', '## 目录'],
]) {
  for (const lineNumber of [19, 20, 21]) {
    await runTocBoundaryCase({
      name: `${language} TOC at line ${lineNumber}`,
      heading,
      lineNumber,
      shouldPass: lineNumber <= 20,
    });
  }
}

await runTest('final cleanup and clean doctor', async () => {
  const residue = (await readdir(docsRoot)).filter((entry) => entry.startsWith(fixturePrefix));
  assert.deepEqual(residue, [], `fixture residue: ${residue.join(', ')}`);
  assertDoctorPasses('final clean doctor');
});

console.log(`\n${passed}/${passed + failures.length} tests passed${workspaceMode ? ' (workspace mode)' : ''}.`);
if (failures.length > 0) {
  process.exitCode = 1;
}
