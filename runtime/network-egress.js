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
// Zero external dependencies. Built-ins only: url, net, dns/promises.

const { URL } = require("url");
const net = require("net");
const dnsPromises = require("dns").promises;

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

  // Normalize allow entries: strings stay as-is; object form contributes its
  // `pattern` field. Object entries with no/blank pattern are dropped (treated
  // identically to legacy filter-by-typeof-string semantics).
  const allow = networkPolicy.allowDomains
    .map(entryPattern)
    .filter((p) => typeof p === "string" && p.length > 0);
  const deny = Array.isArray(networkPolicy.denyDomains)
    ? networkPolicy.denyDomains
        .map(entryPattern)
        .filter((p) => typeof p === "string" && p.length > 0)
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

// ---------------------------------------------------------------------------
// Per-allow-entry helpers (ADR-005 FC #4)
// ---------------------------------------------------------------------------
//
// allowDomains items may be either:
//   - a plain string ("github.com" or "*.github.com")
//   - an object  ({ pattern: "github.com", allowOnLookupFailure: true })
// Both forms participate identically in FC #1-#3 matching. The object form
// carries optional per-entry policy fields that only FC #4 consumes.

function entryPattern(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.pattern === "string") return entry.pattern;
  return "";
}

function entryAllowOnLookupFailure(entry, networkPolicy) {
  // Per-entry override wins when present and boolean.
  if (entry && typeof entry === "object" && typeof entry.allowOnLookupFailure === "boolean") {
    return entry.allowOnLookupFailure;
  }
  // Otherwise fall back to the top-level network default (additive in ADR-005).
  if (networkPolicy && typeof networkPolicy.allowOnLookupFailure === "boolean") {
    return networkPolicy.allowOnLookupFailure;
  }
  // Default-deny on DNS failure (FC #4 invariant).
  return false;
}

function matchingAllowEntry(hostname, allowList) {
  if (!Array.isArray(allowList)) return null;
  for (const entry of allowList) {
    const pat = entryPattern(entry);
    if (pat && hostMatches(hostname, pat)) return entry;
  }
  return null;
}

/**
 * Resolve DNS for the unique hostnames extracted from a command. Async.
 *
 * Returns a map: { hostname → { ok, ips: [...], code: null|string } }.
 * IP literals and loopback hostnames are skipped (no resolution needed).
 * Returns an empty map when no resolvable targets exist or DNS module is
 * unavailable. Always resolves; never rejects.
 *
 * Used by the gate to pre-resolve before calling decide() synchronously.
 */
async function resolveTargets(command, options = {}) {
  const targets = extractTargets(command);
  const out = Object.create(null);
  const hostsSeen = new Set();
  const lookup = options.lookup || ((host) => dnsPromises.lookup(host, { all: true, verbatim: true }));
  for (const t of targets) {
    const host = String(t.host || "").toLowerCase();
    if (!host) continue;
    if (isIpLiteral(host) || isLoopback(host)) continue;
    if (hostsSeen.has(host)) continue;
    hostsSeen.add(host);
    try {
      const records = await lookup(host);
      const ips = Array.isArray(records)
        ? records.map((r) => (r && typeof r === "object" ? r.address : String(r))).filter(Boolean)
        : [];
      out[host] = { ok: true, ips, code: null };
    } catch (err) {
      out[host] = { ok: false, ips: [], code: (err && err.code) ? String(err.code) : "UNKNOWN" };
    }
  }
  return out;
}

/**
 * FC #4 — Evaluate DNS-failure path.
 *
 * Returns { fired, reason, host?, target?, scheme?, resolverCode? }.
 * Fires when an allow-matched destination hostname failed DNS resolution and
 * the per-entry `allowOnLookupFailure` flag is not true (default false).
 *
 * Inputs:
 *   command       — the raw command string (re-extracted; cheap)
 *   networkPolicy — contract scopes.network block (with allowDomains[])
 *   dnsResolutions — { hostname → { ok, ips, code } } map produced by
 *                   resolveTargets() (or pre-computed by the caller).
 *
 * Backward compat: if dnsResolutions is empty or missing, returns
 * { fired:false, reason:"no-dns-results" } — FC #4 is dormant when callers
 * have not pre-resolved DNS.
 */
function evaluateDns(command, networkPolicy, dnsResolutions) {
  if (!networkPolicy || typeof networkPolicy !== "object") {
    return { fired: false, reason: "no-policy" };
  }
  if (!Array.isArray(networkPolicy.allowDomains)) {
    return { fired: false, reason: "no-allow-domains" };
  }
  if (!dnsResolutions || typeof dnsResolutions !== "object") {
    return { fired: false, reason: "no-dns-results" };
  }

  const targets = extractTargets(command);
  if (targets.length === 0) return { fired: false, reason: "no-network-target" };

  const allow = networkPolicy.allowDomains;
  for (const t of targets) {
    const host = String(t.host || "").toLowerCase();
    if (!host) continue;
    if (isIpLiteral(host) || isLoopback(host)) continue;

    const entry = matchingAllowEntry(host, allow);
    // If host was not in allow, FC #1-#3 already handled it; skip.
    if (!entry) continue;

    const res = dnsResolutions[host];
    // No resolution recorded → treat as not-attempted; FC #4 stays dormant
    // for this host (gate may have skipped resolution by design).
    if (!res || typeof res !== "object") continue;
    if (res.ok === true) continue;

    // DNS failed. Honor per-entry allow-on-failure (with policy default fallback).
    if (entryAllowOnLookupFailure(entry, networkPolicy)) continue;

    return {
      fired: true,
      reason: "dns_lookup_failed",
      host,
      target: t.raw,
      scheme: t.scheme,
      resolverCode: (res && res.code) ? String(res.code) : "UNKNOWN",
    };
  }
  return { fired: false, reason: "all-dns-resolved-or-allowed" };
}

/**
 * Build envelope-bound networkTargets from a contract+command+dns triple.
 *
 * Returns an array of { host, port, scheme, resolvedIps[] }. Sorted by host
 * for canonical hashing. Hosts that are IP literals or loopback are recorded
 * with their literal as the only resolvedIp (FC #5 still binds them, but
 * F18 FC #1 already blocks non-loopback IP literals upstream).
 *
 * Excludes hosts not in dnsResolutions or whose lookup failed; FC #4 owns
 * the failure path, so FC #5 only binds successful resolutions.
 */
function buildNetworkTargets(command, dnsResolutions) {
  const targets = extractTargets(command);
  const seen = new Map();
  for (const t of targets) {
    const host = String(t.host || "").toLowerCase();
    if (!host) continue;
    const port = t.port ? Number(t.port) : null;
    const scheme = t.scheme || null;
    const key = `${host}|${port == null ? "" : port}|${scheme || ""}`;
    if (seen.has(key)) continue;

    let resolvedIps = null;
    if (isIpLiteral(host) || isLoopback(host)) {
      resolvedIps = [host];
    } else if (dnsResolutions && dnsResolutions[host] && dnsResolutions[host].ok) {
      resolvedIps = [...new Set(dnsResolutions[host].ips || [])].filter(Boolean).sort();
    }
    if (!resolvedIps || resolvedIps.length === 0) continue;

    seen.set(key, { host, port, scheme, resolvedIps });
  }
  return [...seen.values()].sort((a, b) => {
    if (a.host !== b.host) return a.host < b.host ? -1 : 1;
    const ap = a.port == null ? -1 : a.port;
    const bp = b.port == null ? -1 : b.port;
    if (ap !== bp) return ap - bp;
    const as = a.scheme || "";
    const bs = b.scheme || "";
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
}

/**
 * FC #5 — Envelope-bound IP recheck at exec-time.
 *
 * Returns { fired, reason, host?, observedIp?, envelopeBoundIps? }.
 * Fires when an exec-time observed connection IP is not present in the
 * envelope-bound `resolvedIps` set for its host. O(1) Set membership.
 *
 * Inputs:
 *   networkTargets       — [{ host, resolvedIps[] }, ...] from the
 *                          PreToolUse envelope (envelope.networkTargets).
 *   observedConnectedIps — [{ host, ip }, ...] reported by the harness
 *                          adapter at exec-time. Loopback IPs are exempt.
 *
 * Dormant when either input is missing or empty.
 */
function evaluateIpSet(networkTargets, observedConnectedIps) {
  if (!Array.isArray(networkTargets) || networkTargets.length === 0) {
    return { fired: false, reason: "no-envelope-targets" };
  }
  if (!Array.isArray(observedConnectedIps) || observedConnectedIps.length === 0) {
    return { fired: false, reason: "no-observed-ips" };
  }

  // Group resolvedIps per host into a single Set (a host may appear under
  // multiple ports/schemes; union them so the exec-time check stays O(1)).
  const ipsByHost = new Map();
  for (const e of networkTargets) {
    if (!e || typeof e !== "object") continue;
    const host = String(e.host || "").toLowerCase();
    if (!host) continue;
    const set = ipsByHost.get(host) || new Set();
    for (const ip of e.resolvedIps || []) set.add(String(ip));
    ipsByHost.set(host, set);
  }

  for (const obs of observedConnectedIps) {
    if (!obs || typeof obs !== "object") continue;
    const host = String(obs.host || "").toLowerCase();
    const ip = String(obs.ip || "");
    if (!host || !ip) continue;
    if (isLoopback(ip)) continue;

    const set = ipsByHost.get(host);
    if (!set || set.size === 0) {
      return {
        fired: true,
        reason: "ip_set_mismatch",
        host,
        observedIp: ip,
        envelopeBoundIps: [],
      };
    }
    if (!set.has(ip)) {
      return {
        fired: true,
        reason: "ip_set_mismatch",
        host,
        observedIp: ip,
        envelopeBoundIps: [...set].sort(),
      };
    }
  }
  return { fired: false, reason: "all-observed-ips-bound" };
}

module.exports = {
  extractTargets,
  hostMatches,
  validatePattern,
  evaluate,
  evaluateDns,
  evaluateIpSet,
  resolveTargets,
  buildNetworkTargets,
  entryPattern,
  entryAllowOnLookupFailure,
  matchingAllowEntry,
  isIpLiteral,
  isLoopback,
  LOOPBACK_HOSTS,
};
