#!/usr/bin/env node
"use strict";

// floor-taint-egress.js — F28 pure predicate: staged / cross-call credential
// exfiltration detection.
//
// ADR-037 0.2.0 Task 4 — ESCALATE tier (consent-eligible, NOT inviolable).
//
// Detects the pattern: a secret/credential-class file is read into (or written
// through) an innocuous temp file in call A, then that file is egressed to an
// external host in call B. F27 (single-call) does NOT fire in this scenario;
// F28 closes it via the cross-call provenance graph.
//
// ESCALATE → consent rationale: ADR-036 invariant #6 states "inviolable floors
// decide on single-call action-evidence only". Cross-call session state (taint
// elevation) explicitly violates that invariant — therefore F28 is ESCALATE /
// demotable, not inviolable. Approved (file, host) pair mints a bespoke session
// grant; in-scope calls are not re-interrupted.
//
// INERTNESS GUARANTEE: evalTaintEgressFloor() returns {fired:false} immediately
// when input.provenanceGraph is null (no injection). This, combined with the
// LILARA_TAINT_EGRESS engine guard, means the feature is byte-identical to
// today when the flag is off — zero corpus-replay divergence.
//
// TAINT CLASS: fires ONLY on the F27-narrow credential class (CRED_PATH_PATTERNS
// from floor-secret-egress.js + inline scanSecrets hits). Deliberately EXCLUDES
// the broader F23 "sensitive" set (payments/billing/.env/prod) — those remain
// F23's remit with the existing inviolable block.
//
// COVERAGE BOUND: same as F18/F27 — only egress channels that classifySink /
// network-egress.js recognises (URL-scheme + bare curl/wget/nc/socat). Channels
// not parsed (some scp/rsync forms) won't trip F28 — under-coverage, same
// fail-direction as F27. Document as a known limit, not a silent gap.
//
// GRANT MODEL: bespoke scope scopes.taintEgress:[{host,filePathHash}]. Checked
// HERE (predicate-level) against injected input.consentGrant — bypasses the
// general scopesMatch engine (which has no network branch). Re-asks only when
// the file or host changes; same (file,host) pair is silent after first approval.

const {
  classifySink,
  pathHash,
  tokenHashSet,
  overlapScore,
} = require("./provenance-graph");

const { CRED_PATH_PATTERNS } = require("./floor-secret-egress");

// Minimum overlap constants — match provenance-graph.js tunables for consistency.
const OVERLAP_THRESHOLD = 0.08;
const MIN_SHARED_COUNT  = 3;

// ---------------------------------------------------------------------------
// Bespoke grant check — F28-specific suppression (scopes.taintEgress).
// Returns true when the injected grant covers the exact (host, filePathHash).
// ---------------------------------------------------------------------------
function _grantCoversF28(grant, host, filePathHash, credentialClass = null) {
  if (!grant) return false;
  try {
    // Existing bespoke shape — match exact (host, filePathHash).
    if (host && filePathHash) {
      const entries = grant.scopes?.taintEgress;
      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (e && e.host === host && e.filePathHash === filePathHash) return true;
        }
      }
    }
    // F.7 grant-sharing — shared per-(credentialClass, host) shape. Lets an
    // F27-minted approval (scopes.secretEgress) cover the same (credentialClass,
    // host) on the F28 cross-call path (and vice-versa). Additive; the bespoke
    // taintEgress check above is unchanged.
    if (host && credentialClass) {
      const se = grant.scopes?.secretEgress;
      if (Array.isArray(se)) {
        for (const e of se) {
          if (e && e.host === host && e.credentialClass === credentialClass) return true;
        }
      }
    }
  } catch { /* fail-safe: don't suppress on any error */ }
  return false;
}

// ---------------------------------------------------------------------------
// _hasCredClass — is a graph node credential-tainted (F28-eligible)?
// A node is credClass when it was tagged credClass:true at record time.
// ---------------------------------------------------------------------------
function _isCredClassNode(node) {
  return Boolean(node && node.credClass === true);
}

// ---------------------------------------------------------------------------
// Internal overlap helper — mirrors provenance-graph._hasOverlap.
// ---------------------------------------------------------------------------
function _hasOverlap(aHashes, bHashes) {
  const { score, sharedCount } = overlapScore(aHashes, bHashes);
  return sharedCount >= MIN_SHARED_COUNT && score >= OVERLAP_THRESHOLD;
}

// ---------------------------------------------------------------------------
// evalTaintEgressFloor(input) — PURE, zero I/O, no loader fallback.
//
// input shape (same decide() input):
//   input.provenanceGraph  — injected by pretool-gate.js; null when off
//   input.consentGrant     — injected by pretool-gate.js; null when off
//   input.ir               — canonical Action IR (built outside decide())
//   input.command          — raw command string
//
// Returns:
//   { fired: false }
//   | { fired: true, credClass, host, taintedFilePath, taintedFilePathHash,
//       evidenceKind: "structural" | "content-overlap" }
// ---------------------------------------------------------------------------
function evalTaintEgressFloor(input) {
  // ── INERTNESS GUARD: no injected graph → never fires ─────────────────────
  // This is the primary byte-identical-replay guarantee. The engine guard
  // (LILARA_TAINT_EGRESS env check in decision-engine.js) is defense-in-depth.
  const graph = input && input.provenanceGraph;
  if (!Array.isArray(graph) || graph.length === 0) return { fired: false };

  try {
    const ir      = input && input.ir;
    const command = String((input && input.command) || "");

    // ── 1. Classify the pending call as a sink ─────────────────────────────
    //
    // Pre-check: if ir.networkTargets is non-empty and ALL entries are loopback
    // or package-registry, the command's intended destination is exempt — do not
    // fire F28 even if classifySink falls through to its bare-curl fallback arm.
    // This prevents false positives on `curl -d @/tmp/x http://localhost:…`.
    const irNetTargets = (ir && Array.isArray(ir.networkTargets)) ? ir.networkTargets : [];
    if (irNetTargets.length > 0) {
      const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
      // Package registry exemption — mirrors provenance-graph.PKG_REGISTRY_HOSTS
      const PKG_HOSTS = new Set([
        "registry.npmjs.org", "registry.yarnpkg.com",
        "pypi.org", "files.pythonhosted.org",
        "crates.io", "static.crates.io",
        "proxy.golang.org", "sum.golang.org",
        "rubygems.org", "packagist.org",
        "archive.ubuntu.com", "security.ubuntu.com",
        "formulae.brew.sh",
        "repo.maven.apache.org", "central.sonatype.com",
        "dl.google.com", "storage.googleapis.com",
        "objects.githubusercontent.com",
      ]);
      const allExempt = irNetTargets.every((t) => {
        if (!t) return false;
        if (t.isLoopback) return true;
        const h = String(t.host || "");
        if (LOOPBACK_HOSTS.has(h)) return true;
        if (/^127\./.test(h) || h === "::1") return true;
        // Private IP ranges
        if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
        if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
        if (PKG_HOSTS.has(h)) return true;
        return false;
      });
      if (allExempt) return { fired: false };
    }

    const sink = classifySink(ir);
    if (sink.kind !== "network-send") return { fired: false };

    const host        = sink.host || null;
    const taintedRefs = Array.isArray(sink.taintedRefs) ? sink.taintedRefs : [];

    // Must have either a host or file refs to proceed
    if (!host && taintedRefs.length === 0) return { fired: false };

    // ── 2. Evidence arm 1: structural (pathHash match) ─────────────────────
    //
    // Checks whether any @file ref in the egress command refers to a file that
    // was previously tainted by a credential-class source. Matches against:
    //   - derivative nodes (targetPathHash): secret → write → temp file
    //   - sensitive source nodes (pathHash): direct egress of a cred path read
    for (const ref of taintedRefs) {
      const ph = pathHash(ref);
      if (!ph) continue;

      for (const node of graph) {
        if (!_isCredClassNode(node)) continue;

        const hitTarget = node.targetPathHash && ph === node.targetPathHash;
        const hitSource = node.pathHash       && ph === node.pathHash;

        if (hitTarget || hitSource) {
          const nodeCredClass = node.credClass === true ? (node.sourceClass || "credential") : "credential";
          // Bespoke grant suppression — same (file, host) already approved?
          // F.7: also covered by a shared (credentialClass, host) secretEgress grant.
          if (_grantCoversF28(input.consentGrant, host || "unknown", ph, nodeCredClass)) {
            return { fired: false };
          }
          return {
            fired:              true,
            credClass:          nodeCredClass,
            host:               host || "unknown",
            taintedFilePath:    ref,
            taintedFilePathHash: ph,
            evidenceKind:       "structural",
          };
        }
      }
    }

    // ── 3. Evidence arm 2: content-hash overlap ────────────────────────────
    //
    // Command tokens overlap a credential-class source node's token hashes.
    // Fires when there is statistically significant shared signal (Jaccard ≥
    // OVERLAP_THRESHOLD AND sharedCount ≥ MIN_SHARED_COUNT). Temporal-only
    // (no shared tokens) NEVER fires — same bar as provenance-graph.js.
    const cmdTokens = tokenHashSet(command);
    if (cmdTokens.length >= MIN_SHARED_COUNT) {
      for (const node of graph) {
        if (!_isCredClassNode(node)) continue;
        if (!Array.isArray(node.tokenHashes) || node.tokenHashes.length === 0) continue;

        if (_hasOverlap(cmdTokens, node.tokenHashes)) {
          // For content-overlap we don't have a concrete file ref — use null path.
          // Bespoke grant suppression: key on (host, nodePathHash).
          const nodePh = node.pathHash || node.targetPathHash || null;
          const nodeCredClass = node.sourceClass || "credential";
          // F.7: bespoke (host, nodePathHash) OR shared (credentialClass, host).
          if (_grantCoversF28(input.consentGrant, host || "unknown", nodePh, nodeCredClass)) {
            return { fired: false };
          }
          return {
            fired:               true,
            credClass:           nodeCredClass,
            host:                host || "unknown",
            taintedFilePath:     null,
            taintedFilePathHash: nodePh,
            evidenceKind:        "content-overlap",
          };
        }
      }
    }

    // ── 4. No credClass hit ────────────────────────────────────────────────
    return { fired: false };

  } catch {
    // Fail-open: never throw into decide(). F28 not firing is always safe —
    // the inviolable F27 + F23-enforce backstops remain independent.
    return { fired: false };
  }
}

module.exports = { evalTaintEgressFloor };
