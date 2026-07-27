import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';

import { GRAPH_KINDS, SCHEMA_IDS } from './constants.mjs';

const schemaFiles = [
  'graph.schema.json',
  'node.schema.json',
  'edge.schema.json',
  'event.schema.json',
  'context.schema.json',
  'handoff-receipt.schema.json',
  'master-graph.schema.json',
  'loop-graph.schema.json',
  'phase-handoff.schema.json',
  'phase-result.schema.json',
];

let compiledSchemas;

const strictUtcTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isStrictUtcTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = strictUtcTimestampPattern.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function loadSchema(fileName) {
  const schemaUrl = new URL(`../../schemas/v1/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(schemaUrl, 'utf8'));
}

export function compileSchemas() {
  if (compiledSchemas) return compiledSchemas;

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  ajv.addFormat('dev-flow-utc-date-time', {
    type: 'string',
    validate: isStrictUtcTimestamp,
  });
  ajv.addSchema(schemaFiles.map(loadSchema));

  for (const schemaId of Object.values(SCHEMA_IDS)) {
    ajv.getSchema(schemaId);
  }
  compiledSchemas = ajv;
  return compiledSchemas;
}

export function validateContract(value, schemaId) {
  const validator = compileSchemas().getSchema(schemaId);
  if (!validator) throw new Error(`Schema is not registered: ${schemaId}`);
  const valid = validator(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : [...validator.errors],
  };
}

export function graphSchemaId(graphKind) {
  if (graphKind === GRAPH_KINDS.MASTER) return SCHEMA_IDS.masterGraph;
  if (graphKind === GRAPH_KINDS.LOOP) return SCHEMA_IDS.loopGraph;
  return SCHEMA_IDS.graph;
}

export function validateGraphSchema(graph) {
  return validateContract(graph, graphSchemaId(graph?.graphKind));
}

export function validateEventSchema(event) {
  return validateContract(event, SCHEMA_IDS.event);
}
