import { EXIT_CODES } from './constants.mjs';

export function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function finding(code, rule, path, nodeIds, message) {
  return {
    code,
    rule,
    path,
    nodeIds: [...new Set(nodeIds)].sort(codeUnitCompare),
    message,
  };
}

export function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return codeUnitCompare(leftKey, rightKey);
  });
}

export class WorkflowBlockedError extends Error {
  constructor(code, findings, message = 'Graph workflow is blocked') {
    super(message);
    this.name = 'WorkflowBlockedError';
    this.code = code;
    this.exitCode = EXIT_CODES.BLOCKED;
    this.findings = sortFindings(findings);
  }
}
