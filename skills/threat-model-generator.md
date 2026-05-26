# Skill: threat-model-generator

---
name: threat-model-generator
description: Generate a STRIDE threat model from a free-text architecture description or a Mermaid data-flow diagram. For each component in the system, enumerate Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, and Elevation of privilege threats with severity, likelihood, and a concrete mitigation. Emits a structured markdown report plus a JSON sidecar for tool ingestion or SARIF conversion via skills/sarif-export.md.
---

# Threat Model Generator

Apply systematic STRIDE analysis to a system design before it ships — not in a post-incident review. Takes architecture context as input; outputs a per-threat findings table with concrete mitigations, not abstract security advice.

## When to Use

- A new service or significant feature is being designed and needs a security review before implementation begins
- Preparing for a SOC 2, ISO 27001, or pen-test engagement that requires a documented threat model
- A security champion wants to evaluate an existing system's risk posture in a structured way
- After an incident, to retroactively map what threat category the incident fell into and identify any remaining un-mitigated threats in the same category

## Process

1. **Collect the system description** — gather the inputs:
   - Free-text architecture description (one paragraph minimum describing components, data flows, trust boundaries)
   - Mermaid diagram (if available) — paste the `graph` or `flowchart` block; this skill extracts components and data flows from it
   - Key data assets (PII, financial data, auth tokens, configuration secrets)
   - Existing controls (authentication scheme, encryption at rest/transit, audit logging)

2. **Identify system components and trust boundaries** — decompose the description into:
   - **External actors**: end users, third-party services, partner APIs, IoT devices
   - **Internal components**: API gateway, application servers, databases, message queues, background workers, admin UI
   - **Data flows**: each arrow between components with the data type and protocol
   - **Trust boundaries**: where the trust level changes (internet → DMZ, DMZ → internal, internal → database)

3. **Apply STRIDE per component** — for each component and each data flow crossing a trust boundary, evaluate the six STRIDE threat categories:

   | Threat | Question |
   |--------|----------|
   | **S**poofing | Can an attacker impersonate this component or a legitimate user? |
   | **T**ampering | Can data in transit or at rest be modified without detection? |
   | **R**epudiation | Can an actor deny having performed an action? |
   | **I**nformation disclosure | Can sensitive data be read by an unauthorised party? |
   | **D**enial of service | Can this component be made unavailable? |
   | **E**levation of privilege | Can an actor gain more permissions than granted? |

4. **Score each threat** — use a simplified risk matrix:

   | Severity | Likelihood | Risk level |
   |----------|------------|------------|
   | HIGH | HIGH | CRITICAL |
   | HIGH | MEDIUM | HIGH |
   | MEDIUM | HIGH | HIGH |
   | MEDIUM | MEDIUM | MEDIUM |
   | LOW | any | LOW |

   Severity: business impact if exploited. Likelihood: ease of exploitation given current controls.

5. **Write mitigations** — for each CRITICAL and HIGH threat, write a concrete mitigation (not "add authentication" but "add JWT validation middleware at the API gateway layer using RS256 with a 15-minute expiry and a revocation check against Redis"):

6. **Emit the JSON sidecar** — produce `threat-model.json` for tool ingestion:

   ```json
   {
     "component": "API Gateway",
     "threat_category": "Spoofing",
     "threat_id": "TM-001",
     "description": "Attacker replays a valid JWT from a stolen token",
     "severity": "HIGH",
     "likelihood": "MEDIUM",
     "risk": "HIGH",
     "mitigation": "Implement token binding (RFC 8471) or short-expiry JWTs (15 min) with Redis blacklist on logout"
   }
   ```

## Output Format

```markdown
## STRIDE Threat Model

System: Order Processing Service v2
Date: 2026-05-26
Components analysed: 5
Threats identified: 18 (3 CRITICAL, 7 HIGH, 6 MEDIUM, 2 LOW)

---

### Component: API Gateway (internet-facing)

| ID | STRIDE | Threat | Severity | Likelihood | Risk | Mitigation |
|----|--------|--------|----------|------------|------|------------|
| TM-001 | Spoofing | Attacker replays stolen JWT to authenticate as another user | HIGH | MEDIUM | HIGH | Short-expiry JWTs (15 min); Redis blacklist on logout; device fingerprint binding |
| TM-002 | Tampering | Man-in-the-middle modifies request body in transit | HIGH | LOW | MEDIUM | Enforce HTTPS everywhere; HSTS with 2-year max-age; CORS policy restricts origin |
| TM-003 | Denial of service | Bot traffic floods login endpoint with credential-stuffing | HIGH | HIGH | CRITICAL | Rate-limit login to 5/min per IP; CAPTCHA after 3 failures; block Tor exit nodes |
| TM-004 | Elevation of privilege | User escalates to admin role by forging a JWT `role` claim | CRITICAL | MEDIUM | CRITICAL | Validate `role` claim against authorisation database on every request; never trust client-supplied roles |

### Component: Orders Database

| ID | STRIDE | Threat | Severity | Likelihood | Risk | Mitigation |
|----|--------|--------|----------|------------|------|------------|
| TM-009 | Information disclosure | SQL injection exposes all orders from all users | CRITICAL | MEDIUM | CRITICAL | Parameterised queries enforced by ORM; no dynamic SQL; automated injection tests in CI |
| TM-010 | Tampering | Application-level bug allows user A to update user B's order | HIGH | MEDIUM | HIGH | Row-level security in PostgreSQL; authorisation check in service layer before every write |

---

### Summary

| Risk Level | Count | Top components affected |
|------------|-------|------------------------|
| CRITICAL | 3 | API Gateway, Orders Database |
| HIGH | 7 | Auth Service, Orders Database, Payment Webhook |
| MEDIUM | 6 | Background Worker, Admin UI |
| LOW | 2 | Internal config service |

JSON sidecar: threat-model.json (18 entries)
```

## Constraints

- Accuracy is proportional to the completeness of the system description; vague descriptions produce generic threats — invest time in step 1.
- STRIDE is a breadth-first framework and may miss deep implementation-level vulnerabilities; complement with a code-level security scan (`security-scan` agent) for high-risk components.
- Likelihood scores are qualitative estimates based on the described controls; a penetration test is required for quantitative likelihood assessment.
- Does not generate mitigations for threats rated LOW; LOW threats are documented for awareness but left as accepted risks unless the operator explicitly escalates them.
- The JSON sidecar is compatible with `skills/sarif-export.md` for upload to GitHub code scanning — convert threat IDs to rule IDs and risk levels to SARIF severity levels.
