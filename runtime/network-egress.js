#!/usr/bin/env node
"use strict";

// network-egress.js — F18 Network Egress Control (Phase 0 task 0.4 / ADR-005).
//
// Per-contract domain allowlist for outbound network calls.
// Default-deny: empty allowlist blocks all network. Operator opts in by listing
// trusted domains in `contract.network.allowDomains`. Wildcard support is
// leading-dot only (`*.github.com` matches `api.github.com` and
// `raw.github.com`, but NOT `github.com` itself — operator must add both for
// full coverage). IP-literal hosts are blocked unconditionally except for
// loopback (127.0.0.0/8, ::1, localhost). `denyDomains` overrides allowDomains.
//
// Backwards-compat: F18 enforces only when `network.allowDomains` is present
// in the loaded contract (additive opt-in). Existing v1/v2/v3 contracts
// without the field continue to operate exactly as before.
//
// Zero external dependencies. Built-ins only: url, net.

const { URL } = require("url");
const net = require("net");

// Loopback hostnames are exempt — loopback is not an exfil channel.
// Operators can still deny them explicitly via `denyDomains`.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Schemes we recognise as outbound network. Loopback URLs are allowed by default.
const NETWORK_SCHEME_RE =
  /\b((?:https?|ftps?|wss?|ssh|git|sftp|gopher|telnet|ldaps?):\/\/[^\s'"<>`|;&\\)]+)/gi;

// Tokens that introduce a hostname argument when bare (no scheme).
// Used as a heuristic for `curl example.com` style invocations.
const HOST_BIN_TOKENS = new Set([
  "curl", "wget", "http", "https", "httpie", "xh",
]);

function stripTrailingPunct(s) {
  return String(s || "").replace(/[.,;:'"`)\]>]+$/, "");
}

function stripQuotes(s) {
  const t = String(s || "");
  if (!t) return t;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function tokenBase(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  // strip path components — `curl` from `/usr/bin/curl`
  const slash = t.lastIndexOf("/");
  const last = slash >= 0 ? t.slice(slash + 1) : t;
  return last.toLowerCase();
}

function isIpLiteral(host) {
  if (!host) return false;
  let h = String(host);
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return net.isIP(h) > 0;
}

function isLoopback(host) {
  if (!host) return false;
  let h = String(host).toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (LOOPBACK_HOSTS.has(h)) return true;
  if (net.isIPv4(h) && h.startsWith("127.")) return true;
  if (net.isIPv6(h)) {
    // any ::1 form (including expanded) -> loopback
    if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  }
  return false;
}

function parseUrlLike(raw) {
  try {
    const u = new URL(raw);
    return {
      raw,
      scheme: u.protocol.replace(/:$/, ""),
      host: u.hostname, // unbracketed for IPv6
      port: u.port || null,
      hostDisplay: u.host, // bracketed for IPv6 + port if any
    };
  } catch {
    return null;
  }
}

// Tokenize while respecting simple shell quoting for our extraction needs.
function tokenize(text) {
  const out = [];
  const re = /(?:[^\s"']+|"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[0]);
  }
  return out;
}

function isLikelyHostToken(s) {
  // Bare host[:port][/path], no scheme, must contain a dot OR be a bracketed
  // IPv6 OR an IPv4 dotted quad. Reject things that are obviously paths or flags.
  const t = String(s || "");
  if (!t || t.startsWith("-") || t.startsWith("|") || t.startsWith("&") ||
      t.startsWith(";") || t.startsWith("$") || t.startsWith("/") ||
      t.startsWith(".") || t === "<" || t === ">" || t === "<<" || t === ">>") {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false; // already URL
  // bracketed IPv6
  if (/^\[[0-9a-f:]+\](?::\d+)?(?:\/.*)?$/i.test(t)) return true;
  // hostname with at least one dot, or IPv4
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(?::\d+)?(?:\/.*)?$/i.test(t)) return true;
  return false;
}

/**
 * Extract candidate network targets from a command string.
 * Returns an array of { raw, scheme, host, port, hostDisplay, source }.
 *   - source: "url-scheme" for explicit-scheme URLs, "bare-host" for curl/wget bare-host args.
 */
function extractTargets(command) {
  const text = String(command || "");
  const targets = [];
  const seen = new Set();

  NETWORK_SCHEME_RE.lastIndex = 0;
  let match;
  while ((match = NETWORK_SCHEME_RE.exec(text)) !== null) {
    const raw = stripTrailingPunct(match[1]);
    if (seen.has(raw)) continue;
    const parsed = parseUrlLike(raw);
    if (!parsed || !parsed.host) continue;
    seen.add(raw);
    targets.push({ ...parsed, source: "url-scheme" });
  }

  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const tok = stripQuotes(tokens[i]);
    if (!HOST_BIN_TOKENS.has(tokenBase(tok))) continue;
    for (let j = i + 1; j < tokens.length; j++) {
      let a = stripQuotes(tokens[j]);
      if (!a) continue;
      // Stop at shell separators
      if (a === "|" || a === "&&" || a === "||" || a === ";" || a === "&") break;
      // Skip flag tokens. -d/-X/-H take an arg — skip the next token too if --foo.
      if (a.startsWith("-")) {
        // -F file=@x.txt may include nothing host-like. Just keep scanning.
        continue;
      }
      // Already a URL form? Already handled above. Stop here so we don't
      // double-count and so we don't pick up later separate arguments.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a)) break;
      if (!isLikelyHostToken(a)) {
        // Could be a path arg to curl (-o file) — keep scanning.
        continue;
      }
      const synthesized = "http://" + a;
      const parsed = parseUrlLike(synthesized);
      if (!parsed || !parsed.host) break;
      const raw = a;
      if (seen.has(raw)) break;
      seen.add(raw);
      targets.push({ ...parsed, raw, scheme: null, source: "bare-host" });
      break;
    }
  }

  return targets;
}

/**
 * Match a hostname against an allowDomains pattern.
 * Patterns:
 *   - exact: "github.com" matches "github.com" only
 *   - leading-dot wildcard: "*.github.com" matches any subdomain (api.github.com,
 *     raw.github.com, deep.api.github.com) but NOT the bare apex.
 * Other wildcard placements (api.*.com, *.*.example.com) are rejected by
 * `validatePattern` and treated as non-matching here.
 */
function hostMatches(hostname, pattern) {
  const h = String(hostname || "").toLowerCase();
  const p = String(pattern || "").toLowerCase();
  if (!h || !p) return false;
  if (p === h) return true;
  if (p.startsWith("*.")) {
    const rest = p.slice(2);
    if (!rest || rest.includes("*")) return false;
    return h.endsWith("." + rest);
  }
  return false;
}

/**
 * Validate a single allow/deny pattern. Returns { valid, reason }.
 * Rejects: multi-wildcard, non-leftmost wildcard, IP literals (use IP rules instead).
 */
function validatePattern(pattern) {
  const p = String(pattern || "");
  if (!p) return { valid: false, reason: "empty-pattern" };
  if (p.includes("*")) {
    if (!p.startsWith("*.")) return { valid: false, reason: "wildcard-only-leftmost" };
    if (p.slice(2).includes("*")) return { valid: false, reason: "single-wildcard-only" };
  }
  if (net.isIP(p)) return { valid: false, reason: "ip-literals-not-allowed-in-domain-list" };
  return { valid: true };
}

/**
 * Evaluate a command against a network policy.
 * Returns { fired: bool, reason, host?, target?, scheme? } where fired=true
 * means F18 should block.
 *
 * Fire conditions (per ADR-005 §F18):
 *   1. URL host is an IP literal (non-loopback) → "ip-literal-blocked".
 *   2. URL host explicitly in denyDomains → "deny-domain-match".
 *   3. URL host not in allowDomains (after wildcard match) → "host-not-in-allowlist".
 *
 * Backwards-compat: returns { fired: false, reason: "no-allow-domains" } when
 * the contract has no `network.allowDomains` field. This keeps existing v1/v2/v3
 * contracts (additive schema) operating unchanged.
 */
function evaluate(command, networkPolicy) {
  if (!networkPolicy || typeof networkPolicy !== "object") {
    return { fired: false, reason: "no-policy" };
  }
  if (!Array.isArray(networkPolicy.allowDomains)) {
    return { fired: false, reason: "no-allow-domains" };
  }

  const allow = networkPolicy.allowDomains.filter((s) => typeof s === "string");
  const deny = Array.isArray(networkPolicy.denyDomains)
    ? networkPolicy.denyDomains.filter((s) => typeof s === "string")
    : [];

  const targets = extractTargets(command);
  if (targets.length === 0) {
    return { fired: false, reason: "no-network-target" };
  }

  for (const t of targets) {
    const host = String(t.host || "").toLowerCase();

    // (1) IP literal handling — block unless loopback
    if (isIpLiteral(host)) {
      if (isLoopback(host)) {
        // Loopback may still be denied explicitly
        if (deny.some((p) => p === "localhost" && (host === "127.0.0.1" || host === "::1" || host === "localhost"))) {
          return { fired: true, reason: "deny-domain-match", host, target: t.raw, scheme: t.scheme };
        }
        continue;
      }
      return { fired: true, reason: "ip-literal-blocked", host, target: t.raw, scheme: t.scheme };
    }

    // (2) Deny list takes precedence over allow
    if (deny.some((p) => hostMatches(host, p))) {
      return { fired: true, reason: "deny-domain-match", host, target: t.raw, scheme: t.scheme };
    }

    // (3) Loopback hostname allowed by default
    if (isLoopback(host)) continue;

    // (4) Allow list — fail closed if no match
    if (!allow.some((p) => hostMatches(host, p))) {
      return { fired: true, reason: "host-not-in-allowlist", host, target: t.raw, scheme: t.scheme };
    }
  }

  return { fired: false, reason: "all-targets-allowed" };
}

module.exports = {
  extractTargets,
  hostMatches,
  validatePattern,
  evaluate,
  isIpLiteral,
  isLoopback,
  LOOPBACK_HOSTS,
};
