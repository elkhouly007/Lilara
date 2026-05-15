#!/usr/bin/env node
"use strict";

// receipt-validator.js — ADR-014 audit-grade receipts. Pure, zero-dep
// draft-2020-12 JSON Schema validator (subset) for receipt.v1.json plus a
// helper that pairs schema validation with ADR-004 hash-chain verify().

const fs   = require("fs");
const path = require("path");

const SCHEMA_PATH = path.join(__dirname, "..", "schemas", "receipt.v1.json");
let _schema = null;
function loadSchema() {
  if (_schema) return _schema;
  _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return _schema;
}

const _ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function _kindOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "number") return Number.isInteger(v) ? "integer" : "number";
  return t;
}

function _typeMatches(want, got, value) {
  if (Array.isArray(want)) return want.some((w) => _typeMatches(w, got, value));
  if (want === "number")  return got === "number"  || got === "integer";
  if (want === "integer") return got === "integer" || (got === "number" && Number.isInteger(value));
  return want === got;
}

function _validate(value, schema, pathStr, errors) {
  if (schema.type !== undefined) {
    const got = _kindOf(value);
    if (!_typeMatches(schema.type, got, value)) {
      errors.push({ path: pathStr || "/", message: `type ${got} (expected ${Array.isArray(schema.type) ? schema.type.join("|") : schema.type})` });
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path: pathStr || "/", message: `value !== const ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path: pathStr || "/", message: `value not in enum [${schema.enum.join(",")}]` });
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push({ path: pathStr, message: `string shorter than minLength ${schema.minLength}` });
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push({ path: pathStr, message: `string longer than maxLength ${schema.maxLength}` });
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errors.push({ path: pathStr, message: `string does not match pattern /${schema.pattern}/` });
    if (schema.format === "date-time" && !_ISO_DATETIME.test(value)) errors.push({ path: pathStr, message: "string is not ISO date-time" });
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push({ path: pathStr, message: `number below minimum ${schema.minimum}` });
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push({ path: pathStr, message: `number above maximum ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push({ path: pathStr, message: `array longer than maxItems ${schema.maxItems}` });
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push({ path: pathStr, message: `array shorter than minItems ${schema.minItems}` });
    if (schema.items) for (let i = 0; i < value.length; i++) _validate(value[i], schema.items, pathStr + "/" + i, errors);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const props = schema.properties || {};
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) if (!(k in value)) errors.push({ path: pathStr + "/" + k, message: "missing required field" });
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) errors.push({ path: pathStr + "/" + k, message: "additional property not allowed" });
    }
    for (const k of Object.keys(value)) {
      if (props[k]) _validate(value[k], props[k], pathStr + "/" + k, errors);
    }
  }
}

function validateReceipt(receipt) {
  const errors = [];
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, errors: [{ path: "/", message: "receipt is not a JSON object" }] };
  }
  _validate(receipt, loadSchema(), "", errors);
  return { valid: errors.length === 0, errors };
}

// validateJournalChain({ entries, chainFile? }) — schema-validates each entry
// in `entries` against receipt.v1.json. When `chainFile` is provided, also
// runs ADR-004 hash-chain verify() against that file and folds chain errors
// into the result.
function validateJournalChain(opts) {
  const o = opts || {};
  const entries = Array.isArray(o.entries) ? o.entries : [];
  const schemaErrors = [];
  for (let i = 0; i < entries.length; i++) {
    const r = validateReceipt(entries[i]);
    if (!r.valid) {
      for (const e of r.errors) schemaErrors.push({ entry: i, path: e.path, message: e.message });
    }
  }
  let chainErrors = [];
  let chainEntryCount = 0;
  if (o.chainFile) {
    const { verify } = require("./journal-chain");
    const cr = verify({ file: o.chainFile });
    chainEntryCount = cr.entryCount;
    if (!cr.ok) {
      for (const e of cr.errors) chainErrors.push({ seq: e.seq, line: e.line, reason: e.reason });
    }
  }
  const valid = schemaErrors.length === 0 && chainErrors.length === 0;
  return {
    valid,
    errors: schemaErrors.concat(chainErrors.map((c) => ({ chain: true, ...c }))),
    schemaErrors,
    chainErrors,
    chainEntryCount,
  };
}

module.exports = { validateReceipt, validateJournalChain, loadSchema, SCHEMA_PATH };
