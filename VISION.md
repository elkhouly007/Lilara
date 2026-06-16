# Lilara — VISION (Canonical)

> **Level 1 — the founder's own words.** This file is canonical. It is never altered, never dropped, never
> overridden by any tool or any later decision. Additions by tools (Claude Code / OpenClaw) **extend** this; they
> never replace it, and they are always cited. The verbatim record lives in `context/lilara-vision-verbatim.md`.

---

## What Lilara is

Lilara / ليلارا — named after the founder's daughters **Lily + Lara**. A zero-dependency Node.js runtime security
guard for AI coding agents, growing into a trustworthy **bounded-autonomy platform**.

Powerful agent repos, skills, and tools appear constantly, and people install them **blindly** — running unknown code
with broad authority and no idea what leaves their machine. Lilara collects those capabilities, **redesigns and
rewrites them clean-room**, and delivers them in a place that is safe by construction: **full power AND safety, never a
trade-off.**

**Name lineage:** `ECC` (everything-claude-code) -> **ECC Safe-Plus** (parity phase, on OpenClaw, April 2026) ->
**Agent Runtime Guard** (first git commit 2026-04-23, v1.0.1) -> **HAG / Horus Agentic Guard** (working name through
May) -> **Lilara** (renamed 2026-05-24). GitHub `elkhouly007/Lilara`, PRIVATE until licensing is resolved. VERSION 0.2.1.

---

## The vision (load-bearing points, in the founder's intent)

1. **The smartest tool that makes all tools smarter** — "1000% more capability," that learns and improves itself.
2. **The consent contract.** The user defines up front which action-classes may run without returning to him; inside
   that contract the agent works freely and is **not re-asked**. It interrupts only when something genuinely crosses a
   line. *"لو كل شويه هيتسأل ده هيكون مزعج اكتر و ملوش لزمه."*
3. **Very strong, intelligent memory** — over time it knows the user better than he knows himself (earned, not day-one),
   and it is **token-efficient by design** (see `MEMORY.md`).
4. **Self-improvement** — learns from every task and reviews "could this be done better?", then improves itself;
   auto-selects / merges / creates skills, agents, and hooks; researches competitors + the user's interests weekly;
   **never copy-pastes — always redesigns and rewrites better.**
5. **Cheap orchestration** — a catalog lets it decide which skill/agent to use without burning tokens.
6. **Two run modes** — fast-reply (like OpenClaw) AND long-running for hours/days (like Hermes / Claude Code), chasing a
   goal until it is achieved.
7. **Lilara as a control plane** — the user registers his other tools (Claude Code, Codex, Antigravity, NotebookLLM,
   Hermes, OpenClaw, etc.) into Lilara and runs/manages them from there, **seeing tasks happen live, not in the
   background.** Reachable through channels (Telegram, WhatsApp) once mature.
8. **The inviolable first law** — never cause ultimate harm, no matter the goal.
9. **The real red line** — harming a person: sexual/nude content, defamation/fabrication to disgrace someone, even
   fictional, even when "consent" is claimed. *"متنساش القيم الاسلاميه."* (Full detail in `RED-LINES.md`.)
10. **Data locality** — data stays local; leaves only to destinations the user approved; every change is surfaced for
    review; a weekly reminder re-confirms the approved-destination list. Sharing-to-improve is **default-deny**, decided
    at onboarding, and collects the system's own skills/hooks/self-improvements — **not user data.** Default ON.
11. **Productivity AND security are co-equal.** *"لو مفيش انتاجيه يبقى فشل، لو مفيش امان يبقى فشل بردو."*
12. **As a plugin it is not security-only** — it delivers the full value stack (skills, agents, hooks, memory) so the
    user feels the value immediately.
13. **Three product forms** — plugin, standalone tool/agent, desktop control-plane.
14. **Modes like Claude (ask/plan/auto/bypass) but redesigned better, not copied.**
15. **The power dimension** — **Real Runtime, Long-term Memory, Memory Souls (persistent identity), Breath (a heartbeat
    that wakes on its own and acts proactively), Self-improvement, Orchestration.** Breath and Memory Souls are
    **first-class** (owner decision 2026-06-16; see `MEMORY.md` and `SCOPE.md`).
16. **Full scope and full plan, not phase 1 only** — *"we need to finish full scope and full plan not only phase 1."*

---

## Breath + Memory Souls (first-class — owner decision 2026-06-16)

These were named in the power vision and the business idea, and are now canonical first-class capabilities, not
north-star-only:

- **Breath.** Lilara is always running and watching its tasks — it does not sleep waiting to be woken. If it dispatched
  a task to a tool and that tool has a question or needs plan approval, Lilara sees it and responds quickly instead of
  waiting for the user to notice. When one task finishes, it proceeds to the next toward the user's stated goal. For an
  existing product, it periodically runs tests, finds issues, and either acts (within granted scope) or asks. The
  principle: **always active, responding as if a teammate messaged it — not only the user.**
- **Memory Souls / Smart Memory.** A Second Brain, but smarter: long-term memory for the important things; less-important
  things become clear **smart tags** that let Lilara know what to look at without burning many tokens. It never forgets,
  yet keeps the memory token clean — the user never has to remind it "look at X" or "I said this before." Core principle:
  **always-on memory, but intelligent and token-efficient — it reduces token usage, not inflates it.**

---

*Companion canonical files: `MISSION.md`, `SCOPE.md`, `CONTRACT.md`, `RED-LINES.md`, `MEMORY.md`, `SOUL.md`.
Role handovers: `HANDOVER-OPENCLAW.md`, `HANDOVER-HERMES.md`.*
