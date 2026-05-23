#!/usr/bin/env node
"use strict";

// config-validator.js — Pragmatic JSON schema validator for lilara.config.json and
// lilara.contract.json. Validates types, required fields, enum values, and
// additionalProperties. No ajv/zod dependency.

const fs   = require("fs");
const path = require("path");

const CONFIG_SCHEMA_FILE   = path.join(__dirname, "..", "schemas", "lilara.config.schema.json");
const CONTRACT_SCHEMA_FILE = path.join(__dirname, "..", "schemas", "lilara.contract.schema.json");

let _configSchema   = null;
let _contractSchema = null;

function loadSchema(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getConfigSchema()   { return _configSchema   || (_configSchema   = loadSchema(CONFIG_SCHEMA_FILE)); }
function getContractSchema() { return _contractSchema || (_contractSchema = loadSchema(CONTRACT_SCHEMA_FILE)); }

// ---------------------------------------------------------------------------
// Core validation engine
// ---------------------------------------------------------------------------

/**
 * Validate a value against a schema node. Returns array of error strings.
 * @param {*} value
 * @param {object} schema — a JSON schema node
 * @param {string} path   — dot-path for error messages
 * @returns {string[]}
 */
function validateNode(value, schema, keyPath) {
  const errors = [];

  if (value === undefined || value === null) {
    if (schema.required) {
      errors.push(`${keyPath}: required but missing`);
    }
    return errors;
  }

  // Type check
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    let actualType = Array.isArray(value) ? "array" : (value === null ? "null" : typeof value);
    // JSON Schema: "integer" is a subtype of "number". Promote numeric integers so
    // that a schema declaring type:"integer" accepts 1 but not 1.5.
    if (actualType === "number" && types.includes("integer") && Number.isInteger(value)) {
      actualType = "integer";
    }
    if (!types.includes(actualType)) {
      errors.push(`${keyPath}: expected ${types.join("|")}, got ${actualType}`);
      return errors; // further checks on wrong type are noise
    }
  }

  // Enum
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${keyPath}: value "${value}" not in enum [${schema.enum.join(", ")}]`);
  }

  // Pattern (string)
  if (schema.pattern && typeof value === "string") {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push(`${keyPath}: value does not match pattern ${schema.pattern}`);
    }
  }

  // Numeric range
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${keyPath}: value ${value} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${keyPath}: value ${value} is greater than maximum ${schema.maximum}`);
    }
  }

  // Object properties
  if (schema.type === "object" || (typeof value === "object" && !Array.isArray(value))) {
    // Required fields
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in value)) {
          errors.push(`${keyPath}.${req}: required field missing`);
        }
      }
    }
    // Property schemas
    if (schema.properties) {
      for (const [k, propSchema] of Object.entries(schema.properties)) {
        if (k in value) {
          errors.push(...validateNode(value[k], propSchema, `${keyPath}.${k}`));
        }
      }
    }
    // Additional properties
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(value)) {
        if (!allowed.has(k)) {
          errors.push(`${keyPath}.${k}: additional property not allowed`);
        }
      }
    }
  }

  // Array items
  if (schema.type === "array" || Array.isArray(value)) {
    if (schema.items && Array.isArray(value)) {
      value.forEach((item, i) => {
        errors.push(...validateNode(item, schema.items, `${keyPath}[${i}]`));
      });
    }
    if (typeof schema.minItems === "number" && Array.isArray(value) && value.length < schema.minItems) {
      errors.push(`${keyPath}: array has ${value.length} items, minimum is ${schema.minItems}`);
    }
  }

  return errors;
}

/**
 * Validate an lilara.config.json document.
 * @param {object} doc
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(doc) {
  try {
    const schema = getConfigSchema();
    const errors = validateNode(doc, schema, "config");
    return { valid: errors.length === 0, errors };
  } catch (err) {
    return { valid: false, errors: [`schema load failed: ${err.message}`] };
  }
}

/**
 * Validate an lilara.contract.json document.
 * @param {object} doc
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateContract(doc) {
  try {
    const schema = getContractSchema();
    const errors = validateNode(doc, schema, "contract");
    return { valid: errors.length === 0, errors };
  } catch (err) {
    return { valid: false, errors: [`schema load failed: ${err.message}`] };
  }
}

module.exports = { validateConfig, validateContract, validateNode };
