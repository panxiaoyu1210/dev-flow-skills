import { codeUnitCompare, finding, sortFindings } from './errors.mjs';

function lintResult(findings) {
  const stable = sortFindings(findings);
  return { valid: stable.length === 0, findings: stable };
}

function linePath(index) {
  return `/lines/${index + 1}`;
}

const subjectiveCriterion = /\b(?:feels?|seems?)\s+(?:done|complete|good|right)|\blooks?\s+(?:done|complete|good|right)|\bgood enough\b|\bsatisfactory\b/i;
const genericCriterion = /^(?:everything|all(?:\s+(?:work|steps?|items?))?)\s+(?:is|are)\s+(?:complete|done)(?:\s+and\s+(?:ready|complete|done))?[.!]?$/i;
const observableCriterion = /\b(?:agree|agrees|allow|allows|approved|binds?|blocked|checkable|checked|complete|exists?|explicit|fails?|known|machine-check|matches?|names?|passes?|passed|persisted|ready|read-only|reconciled|recorded|records?|reflects?|resolved|returns?|reviewed|satisfied|selected|states?|succeeds?|truthful|unambiguous|validates?|verified)\b/i;

export function lintSkillAuthoring(content, options = {}) {
  const lines = content.split(/\r?\n/);
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\d+)\. \*\*.+\*\*/);
    if (match) steps.push({ index, number: Number(match[1]) });
  }
  const findings = [];
  if (steps.length === 0) findings.push(finding(
    'authoring_step_missing',
    'authoring.numbered_steps',
    '/',
    [],
    `${options.filePath ?? 'Skill'} must contain numbered executable steps`,
  ));
  for (let position = 0; position < steps.length; position += 1) {
    const step = steps[position];
    const end = steps[position + 1]?.index ?? lines.length;
    const criteria = [];
    for (let index = step.index + 1; index < end; index += 1) {
      const match = lines[index].match(/^\s+\*\*Complete when:\*\*\s*(.*)$/);
      if (match) criteria.push({ index, text: match[1].trim() });
    }
    if (criteria.length !== 1) {
      findings.push(finding(
        'completion_criterion_count',
        'authoring.one_completion_per_step',
        linePath(step.index),
        [],
        `Step ${step.number} must have exactly one Complete when criterion; found ${criteria.length}`,
      ));
      continue;
    }
    const criterion = criteria[0];
    if (criterion.text.length < 12
      || subjectiveCriterion.test(criterion.text)
      || genericCriterion.test(criterion.text)
      || !observableCriterion.test(criterion.text)) {
      findings.push(finding(
        'completion_criterion_not_observable',
        'authoring.observable_completion',
        linePath(criterion.index),
        [],
        `Step ${step.number} completion must name an objective, observable result`,
      ));
    }
  }
  return lintResult(findings);
}

const graphDangerousVerb = '(?:overwrit(?:e|es|ten|ing)|rewrit(?:e|es|ten|ing)|merg(?:e|es|ed|ing)(?:\\s+into)?|write(?:s|written|writing)?\\s*(?:-|\\s)?back(?:\\s+(?:to|into))?|read(?:s|ing)?\\b[^,;。；！？]*\\bback(?:\\s+(?:to|into))?|driv(?:e|es|en|ing))';
const graphViewSource = '(?:Markdown|generated\\s+views?|evidence\\s+views?|control\\s+ledgers?|(?:dev-flow-state|progress|loop-state|loop-envelope|task-orchestration)\\.md)';

// This is deliberately a finite authoring grammar, not general-purpose NLP. Split
// propositions where a new subject or consequence begins so a prohibition in one
// proposition cannot authorize a dangerous predicate in another.
function authorityPropositions(line) {
  const coordinated = line.replace(
    /,\s*(?:(?:and\s+)?therefore|and|but|however|which)\s+/gi,
    '\n',
  );
  return coordinated
    .split(/[;。；！？\n]|\.(?=\s+[A-Z\u00c0-\u00de\u4e00-\u9fff])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasDangerousAuthorityMutation(proposition, viewAntecedent) {
  const viewToGraph = new RegExp(`${graphViewSource}[^,;。；！？]*\\b${graphDangerousVerb}[^,;。；！？]*\\bGraph\\b`, 'i');
  const pronounToGraph = new RegExp(`^(?:(?:it|this|that|they)\\s+)?${graphDangerousVerb}[^,;。；！？]*\\bGraph\\b`, 'i');
  const graphFromView = new RegExp(`\\bGraph\\b[^,;。；！？]*\\b(?:${graphDangerousVerb}|(?:is|be|been)\\s+(?:overwritten|rewritten|merged|driven))[^,;。；！？]*(?:\\bby\\b[^,;。；！？]*)?${graphViewSource}`, 'i');
  const graphReadsView = new RegExp(`\\bGraph(?:\\s+mode|\\s+state)?\\b[^,;。；！？]*\\b(?:read|reads|use|uses|take|takes)[^,;。；！？]*${graphViewSource}[^,;。；！？]*(?:\\bback\\b|\\bas\\s+(?:a\\s+)?control\\s+input\\b|\\bto\\s+drive\\b)`, 'i');
  const dualWritable = /\b(?:bidirectional|bi-directional|two-way|dual-writ(?:e|able|ten|ing)|both\s+Markdown\s+and\s+Graph)\b|双向(?:合并|同步|写)|双可写/i.test(proposition);
  const chineseWriteBack = /(?:Markdown|生成的?\s*Markdown|视图|状态文件)[^。；！？]*(?:回写|覆盖|改写|重写|合并|驱动)[^。；！？]*Graph(?:\s*状态)?/i.test(proposition)
    || /Graph(?:\s*模式|\s*状态)?[^。；！？]*(?:读取|使用)[^。；！？]*(?:Markdown|视图|状态文件)[^。；！？]*(?:驱动|回写|覆盖|改写|重写|合并)/i.test(proposition);
  return dualWritable
    || viewToGraph.test(proposition)
    || graphFromView.test(proposition)
    || graphReadsView.test(proposition)
    || chineseWriteBack
    || (viewAntecedent && pronounToGraph.test(proposition));
}

function explicitlyForbidsAuthorityMutation(proposition) {
  const exactPrefix = new RegExp(
    `\\b(?:(?:must|shall)\\s+not|do(?:es)?\\s+not|never|cannot|can't)\\s+`
      + `(?:(?:(?:allow|permit)(?:s|ted|ting)?|(?:use|uses|used|using))\\b[^,;。；！？]*?\\bto\\s+)?`
      + `(?:be\\s+)?${graphDangerousVerb}`,
    'i',
  );
  const exactDangerSuffix = /^\s*(?:[-*]\s*)?(?:(?:bidirectional|bi-directional|two-way|dual-writ)|(?:Markdown|generated views?|evidence views?)[^,;。；！？]*(?:overwrite|rewrite|merge|write back|drive))[^,;。；！？]*\b(?:is|are)\s+(?:forbidden|prohibited|not allowed)\b/i;
  const directNo = /\bno\s+(?:bidirectional|bi-directional|two-way|dual-writ(?:e|able|ten|ing))\b/i;
  const chinesePrefix = /^\s*(?:[-*]\s*)?(?:Graph\s*模式[^。；！？]*)?(?:不得|禁止|严禁|不可)(?:允许|使用|读取)?[^。；！？]*(?:覆盖|改写|重写|合并|回写|回灌|驱动|双向|双可写)/i;
  return exactPrefix.test(proposition)
    || exactDangerSuffix.test(proposition)
    || directNo.test(proposition)
    || chinesePrefix.test(proposition);
}

function isModeQualified(line) {
  return /\b(?:Legacy|Shadow|Graph mode|authority mode|mode-specific)\b|(?:Legacy|Shadow|Graph)\s*模式|权威模式/i.test(line);
}

export function lintAuthorityLanguage(content, options = {}) {
  const lines = content.split(/\r?\n/);
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const propositions = authorityPropositions(line);
    const viewAntecedent = new RegExp(graphViewSource, 'i').test(line);
    const unsafeAuthorityMutation = propositions.some((proposition) => (
      hasDangerousAuthorityMutation(proposition, viewAntecedent)
      && !explicitlyForbidsAuthorityMutation(proposition)
    ));
    if (unsafeAuthorityMutation) findings.push(finding(
      'authority_dual_write_forbidden',
      'authoring.single_authority_writer',
      linePath(index),
      [],
      `${options.filePath ?? 'Document'} must not prescribe bidirectional merge or dual-writable control facts`,
    ));

    const unqualifiedMarkdownAuthority = /\bMarkdown\b.{0,40}\b(?:is|remains|becomes)\b.{0,24}\b(?:authoritative|source of truth|canonical (?:state|control|ledger|authority|source))\b/i.test(line);
    const unqualifiedLedgerAuthority = /(?:`(?:dev-flow-state|progress|loop-state|loop-envelope|task-orchestration)\.md`).{0,80}\b(?:authoritative|source of truth|canonical (?:state|signal|ledger)|write back|rewrite|correct)\b/i.test(line);
    const graphAssignsMarkdownAuthority = /\bGraph mode\b.{0,100}\bMarkdown\b.{0,60}\b(?:authoritative|canonical|source of truth)\b/i.test(line);
    const modeUnqualified = (unqualifiedMarkdownAuthority || unqualifiedLedgerAuthority)
      && !isModeQualified(line)
      && !propositions.some((proposition) => explicitlyForbidsAuthorityMutation(proposition));
    if (graphAssignsMarkdownAuthority || modeUnqualified) findings.push(finding(
      'authority_mode_unqualified',
      'authoring.mode_qualified_authority',
      linePath(index),
      [],
      `${options.filePath ?? 'Document'} assigns Markdown control authority or write-back without a Legacy/Shadow/Graph branch`,
    ));
  }
  return lintResult(findings);
}

export function lintGraphProtocolAuthoring(content) {
  const requirements = [
    ['shadow_projection_fence_missing', /```dev-flow-graph/],
    ['shadow_projection_error_contract_missing', /shadow_projection_missing[\s\S]*shadow_projection_invalid[\s\S]*shadow_projection_ambiguous/],
    ['shadow_init_check_contract_missing', /\binit\b[\s\S]*\bcheck\b/i],
    ['shadow_drift_contract_missing', /\bdrift\b/i],
    ['shadow_refresh_contract_missing', /\brefresh\b[\s\S]*(?:one-way|never a merge)/i],
    ['graph_recovery_order_missing', /actual state\s*(?:->|→)\s*Graph\s*(?:->|→)\s*OpenSpec\/evidence views/i],
    ['graph_write_api_contract_missing', /Graph CLI\/API/i],
    ['graph_view_readback_forbidden_missing', /Markdown views?[^\n]*(?:never|not)[^\n]*read back/i],
  ];
  return lintResult(requirements
    .filter(([, pattern]) => !pattern.test(content))
    .map(([code]) => finding(code, 'authoring.graph_protocol', '/', [], `Missing Graph authoring contract: ${code}`))
    .sort((left, right) => codeUnitCompare(left.code, right.code)));
}
