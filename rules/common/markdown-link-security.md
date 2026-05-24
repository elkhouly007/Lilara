---
title: Markdown Link Security
description: Rules for detecting dangerous URL patterns weaponized via markdown link syntax
category: security
last_reviewed: "2026-05-25"
version_target: "0.1.x"
severity: high
---

# Markdown Link Security Rules

Markdown link syntax — `[text](url)` — can be weaponized to deliver malicious payloads
when an agent renders or acts on generated content. These rules cover four distinct
injection vectors: `javascript:` scheme execution, `data:` URI injection, userinfo-based
credential smuggling, and token leakage via query strings.

---

## MD-LINK-JS-SCHEME

**Pattern:** `](javascript:...)`

**Severity:** high

Detects markdown links whose URL begins with the `javascript:` scheme. When rendered
in a browser context or Markdown preview, a `javascript:` href executes arbitrary
JavaScript on click, bypassing content-security protections.

**Example payload:**

```
[Click here](javascript:alert(document.cookie))
[Safe link](https://example.com)  ← this is fine
```

**Regex used:** `/\]\(\s*javascript\s*:/i`

**Recommended action:** Block or redact the link. Replace with a safe placeholder.

**References:**
- RFC 3986 §3.1 — URI scheme syntax
- OWASP: "DOM-based XSS via javascript: href"
  (`https://owasp.org/www-community/attacks/xss/`)

---

## MD-LINK-DATA-SCHEME

**Pattern:** `](data:...)`

**Severity:** high

Detects markdown links using the `data:` URI scheme. A `data:text/html,<script>…`
URI renders an inline HTML document in the browser, enabling script execution without
a remote origin. Often combined with base64 encoding to evade naive string filters.

**Example payload:**

```
[Click here](data:text/html,<script>alert(1)</script>)
[Image](data:image/png;base64,iVBOR...)  ← also flagged for review
```

**Regex used:** `/\]\(\s*data\s*:/i`

**Recommended action:** Block data: URIs in generated output. Images can use
`![alt](https://...)`  hosted URLs instead.

**References:**
- RFC 2397 — The "data" URL scheme
- OWASP: "Data URI injection" (`https://owasp.org/www-community/attacks/`)

---

## MD-LINK-USERINFO

**Pattern:** `](https://user:pass@host/...)`

**Severity:** medium

Detects markdown links whose URL contains a userinfo component (`user:pass@host`).
Browsers suppress display of the userinfo segment, so a link styled as
`[legitimate-site.com](https://user:evil@evil.com)` can mislead operators into
clicking a credential-bearing URL destined for an attacker-controlled host.

**Example payload:**

```
[Click to access dashboard](https://admin:password@evil.com/steal)
[legit-site.com](https://legit-site.com:hunter2@phishing.example.com)
```

**Regex used:** `/\]\(\s*https?:\/\/[^/@\s)]+:[^/@\s)]+@/i`

**Recommended action:** Strip userinfo before rendering. Log the original URL for audit.

**References:**
- RFC 3986 §3.2.1 — Userinfo subcomponent
- OWASP: "Authentication bypass via userinfo"

---

## MD-LINK-TOKEN-IN-QUERY

**Pattern:** `](https://...?api_key=...)`

**Severity:** high

Detects markdown links that embed sensitive credential names (`api_key`, `access_token`,
`auth_token`, `token`, `password`, `secret`) as query parameters. A link rendered in a
log, commit message, PR description, or notification leaks the token to anyone with
read access — including CI systems, log aggregators, and code search indexes.

**Example payload:**

```
[Docs](https://api.example.com/v1/users?access_token=ghp_XXXXXXXXXXXXXXXXX)
[Report](https://dashboard.internal/export?secret=sk-proj-XXXXX&format=csv)
```

**Regex used:** `/\]\(\s*https?:\/\/[^\s)]+\?[^)]*\b(?:api_key|access_token|auth_token|token|password|secret)=/i`

**Recommended action:** Redact the query parameter value. Route through
`scripts/redact-payload.sh` before logging or committing.

**References:**
- OWASP: "Sensitive Data Exposure" (`https://owasp.org/www-project-top-ten/`)
- GitHub token-in-URL incident reports (multiple CVEs via search-index disclosure)
