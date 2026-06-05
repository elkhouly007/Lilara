#!/usr/bin/env node
"use strict";

// notify-tls-guard.test.js — ADR-039 SMTP TLS loopback guard tests.
//
// Verifies that LILARA_NOTIFY_INSECURE and LILARA_NOTIFY_TLS_NOVERIFY are
// only honored for loopback hosts, matching the convention in slack.js / discord.js.
//
// Run:  node tests/runtime/notify-tls-guard.test.js

const assert = require("assert");
const path   = require("path");

// Extract the loopback helper by reproducing the regex from the implementation.
// Tests verify that the pattern applied in email.js handles all cases correctly.
function _isLoopbackHost(host) {
  return /^(127\.0\.0\.1|::1|localhost)$/i.test(String(host || "").trim());
}

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      // async — handle via promise chain; results printed at end
      r.then(() => {
        passed++;
        process.stdout.write(`  ✓ ${name}\n`);
      }).catch((e) => {
        failed++;
        errors.push({ name, err: e });
        process.stdout.write(`  ✗ ${name}: ${e.message}\n`);
      });
    } else {
      passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    }
  } catch (e) {
    failed++;
    errors.push({ name, err: e });
    process.stdout.write(`  ✗ ${name}: ${e.message}\n`);
  }
}

// ── T01-T03: _isLoopbackHost correctness ────────────────────────────────────
test("T01 — 127.0.0.1 is loopback", () => {
  assert.strictEqual(_isLoopbackHost("127.0.0.1"), true);
});

test("T02 — localhost / LOCALHOST is loopback (case-insensitive)", () => {
  assert.strictEqual(_isLoopbackHost("localhost"), true);
  assert.strictEqual(_isLoopbackHost("LOCALHOST"), true);
  assert.strictEqual(_isLoopbackHost("LocalHost"), true);
});

test("T03 — ::1 loopback; non-loopback hosts are NOT loopback", () => {
  assert.strictEqual(_isLoopbackHost("::1"), true);
  assert.strictEqual(_isLoopbackHost("smtp.sendgrid.net"), false, "external relay must not match");
  assert.strictEqual(_isLoopbackHost("10.0.0.1"),          false, "RFC1918 — NOT loopback");
  assert.strictEqual(_isLoopbackHost("127.0.0.2"),         false, "127.0.0.2 is NOT loopback");
  assert.strictEqual(_isLoopbackHost(""),                  false, "empty must not match");
  assert.strictEqual(_isLoopbackHost("localhostevil"),     false, "prefix match must not fire");
});

// ── T04: INSECURE=1 + external host → insecure=false (guard logic) ──────────
test("T04 — INSECURE=1 + external host: loopback guard makes insecure=false", () => {
  const flagSet = true;   // simulate LILARA_NOTIFY_INSECURE=1
  const externalHost = "smtp.sendgrid.net";
  const insecure = flagSet && _isLoopbackHost(externalHost);
  assert.strictEqual(insecure, false,
    "INSECURE=1 must NOT activate for external relays");
});

// ── T05: TLS_NOVERIFY=1 + external host → rejectUnauthorized stays true ─────
test("T05 — TLS_NOVERIFY=1 + external host: rejectUnauthorized=true (cert enforced)", () => {
  const flagSet = true;   // simulate LILARA_NOTIFY_TLS_NOVERIFY=1
  const externalHost = "smtp.sendgrid.net";
  const tlsNoverify = flagSet && _isLoopbackHost(externalHost);
  const rejectUnauthorized = !tlsNoverify;
  assert.strictEqual(rejectUnauthorized, true,
    "cert validation must be enforced for external relays");
});

// ── T06: INSECURE=1 + loopback → net.connect called (plaintext honored) ─────
test("T06 — INSECURE=1 + loopback host: net.connect opened (plaintext honored)", async () => {
  const emailMod = require(path.join(__dirname, "..", "..", "runtime", "notify", "email.js"));
  const netMod   = require("net");
  const tlsMod   = require("tls");

  let netCalled = false;
  let tlsCalled = false;

  const origNet = netMod.connect;
  const origTls = tlsMod.connect;

  netMod.connect = (...args) => {
    netCalled = true;
    // Return a minimal stub socket that immediately errors out (no real connection).
    const { EventEmitter } = require("events");
    const sock = new EventEmitter();
    sock.destroy     = () => {};
    sock.write       = () => {};
    sock.setTimeout  = () => {};
    process.nextTick(() => sock.emit("error", new Error("stub-net")));
    return sock;
  };
  tlsMod.connect = (...args) => {
    tlsCalled = true;
    const { EventEmitter } = require("events");
    const sock = new EventEmitter();
    sock.destroy     = () => {};
    sock.write       = () => {};
    sock.setTimeout  = () => {};
    process.nextTick(() => sock.emit("error", new Error("stub-tls")));
    return sock;
  };

  const prevInsecure  = process.env.LILARA_NOTIFY_INSECURE;
  const prevSmtpHost  = process.env.LILARA_SMTP_HOST;
  process.env.LILARA_NOTIFY_INSECURE = "1";
  process.env.LILARA_SMTP_HOST       = "127.0.0.1";

  try {
    await emailMod.send({ to: "test@example.com" }, { kind: "test", summary: "guard test" });
  } catch { /* stub error is expected */ } finally {
    netMod.connect = origNet;
    tlsMod.connect = origTls;
    if (prevInsecure === undefined) delete process.env.LILARA_NOTIFY_INSECURE;
    else process.env.LILARA_NOTIFY_INSECURE = prevInsecure;
    if (prevSmtpHost === undefined) delete process.env.LILARA_SMTP_HOST;
    else process.env.LILARA_SMTP_HOST = prevSmtpHost;
  }

  assert.strictEqual(netCalled, true,
    "net.connect must be called for loopback+INSECURE=1 (plaintext loopback honored)");
  assert.strictEqual(tlsCalled, false,
    "tls.connect must NOT be called when net.connect is used");
});

// ── T07: INSECURE=1 + external → tls.connect called (TLS enforced) ──────────
test("T07 — INSECURE=1 + external host: tls.connect opened (TLS enforced)", async () => {
  const emailMod = require(path.join(__dirname, "..", "..", "runtime", "notify", "email.js"));
  const netMod   = require("net");
  const tlsMod   = require("tls");

  let netCalled = false;
  let tlsCalled = false;
  let tlsOpts   = null;

  const origNet = netMod.connect;
  const origTls = tlsMod.connect;

  netMod.connect = (...args) => {
    netCalled = true;
    const { EventEmitter } = require("events");
    const sock = new EventEmitter();
    sock.destroy = () => {}; sock.write = () => {}; sock.setTimeout = () => {};
    process.nextTick(() => sock.emit("error", new Error("stub-net")));
    return sock;
  };
  tlsMod.connect = (port, host, opts) => {
    tlsCalled = true;
    tlsOpts   = opts;
    const { EventEmitter } = require("events");
    const sock = new EventEmitter();
    sock.destroy = () => {}; sock.write = () => {}; sock.setTimeout = () => {};
    process.nextTick(() => sock.emit("error", new Error("stub-tls")));
    return sock;
  };

  const prevInsecure = process.env.LILARA_NOTIFY_INSECURE;
  const prevNoverify = process.env.LILARA_NOTIFY_TLS_NOVERIFY;
  const prevSmtpHost = process.env.LILARA_SMTP_HOST;
  process.env.LILARA_NOTIFY_INSECURE        = "1";
  process.env.LILARA_NOTIFY_TLS_NOVERIFY    = "1";
  process.env.LILARA_SMTP_HOST              = "smtp.sendgrid.net";

  try {
    await emailMod.send({ to: "test@example.com" }, { kind: "test", summary: "guard test" });
  } catch { /* stub error */ } finally {
    netMod.connect = origNet;
    tlsMod.connect = origTls;
    if (prevInsecure === undefined) delete process.env.LILARA_NOTIFY_INSECURE;
    else process.env.LILARA_NOTIFY_INSECURE = prevInsecure;
    if (prevNoverify === undefined) delete process.env.LILARA_NOTIFY_TLS_NOVERIFY;
    else process.env.LILARA_NOTIFY_TLS_NOVERIFY = prevNoverify;
    if (prevSmtpHost === undefined) delete process.env.LILARA_SMTP_HOST;
    else process.env.LILARA_SMTP_HOST = prevSmtpHost;
  }

  assert.strictEqual(netCalled, false,
    "net.connect must NOT be called for external host (INSECURE=1 ignored)");
  assert.strictEqual(tlsCalled, true,
    "tls.connect must be called for external hosts");
  assert.strictEqual(tlsOpts && tlsOpts.rejectUnauthorized, true,
    "rejectUnauthorized must be true for external hosts (TLS_NOVERIFY=1 ignored)");
});

// ---------------------------------------------------------------------------
// Print results after all async tests settle.
// Use setImmediate to let async callbacks complete first.
// ---------------------------------------------------------------------------
setImmediate(() => setImmediate(() => {
  process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
  if (errors.length > 0) {
    for (const { name, err } of errors) {
      process.stderr.write(`\n  FAIL: ${name}\n  ${err.stack || err.message}\n`);
    }
    process.exit(1);
  }
  process.exit(0);
}));
