# Lilara — SMART MEMORY + BREATH (Memory Souls)

> Canonical (Level 1), elevated to **first-class scope** by owner decision 2026-06-16. This file defines two capabilities
> the product is not worth shipping without: **Smart Memory (Memory Souls)** and **Breath**. Both are now scoped items,
> not north-star-only (see `SCOPE.md`).

---

## 1. Smart Memory / Memory Souls

**Think Second Brain, but smarter.** Lilara has long-term memory for the important things, and over time it knows the
user better than he knows himself — but the defining property is that it is **intelligent and token-efficient.**

**The model:**
- **Long-term memory** holds the important things durably.
- **Less-important things become clear SMART TAGS** — lightweight pointers that let Lilara know *what to look at* without
  loading everything. The tags tell it where to look; it pulls the detail only when relevant.
- **It never forgets, yet keeps the memory token clean.** The user never has to remind it "look at X" or "I said this
  before."
- **When the user asks something, Lilara reviews the tagged memory quickly — only the parts relevant to the question** —
  instead of wasting tokens reviewing everything.

**Core principle:** always-on memory, but **intelligent and token-efficient — it reduces token usage, not inflates it.**
A memory layer that bloats the context is a failure of this design, not a feature of it.

**Memory Souls** = persistent identity. Lilara carries who the user is, how he works, and what matters to him across
sessions — a continuous self, not a fresh start each time.

**Privacy is built in.** Memory is local, inspectable, and erasable. It is governed by the same red lines and the
approved-destinations contract: memory content stays local and leaves only to destinations the user approved.
Privacy-by-construction (the typed allowlist-only serializer) is the enabler — memory cannot become a silent egress
path.

---

## 2. Breath

**Lilara is always running and watching its tasks — it does not sleep waiting to be woken.** Breath is the heartbeat
that makes Lilara behave like an active teammate rather than a tool that only reacts to the user.

**What Breath does (illustrative, not exhaustive):**
- **Watches dispatched work.** If it handed a task to a tool (e.g. Claude Code) and that tool has a question or needs
  plan approval, Lilara **sees it and responds quickly** — within its granted scope — instead of waiting for the user to
  notice.
- **Keeps things moving.** When one task finishes, it proceeds to the next toward the user's stated goal.
- **Maintains existing products.** It periodically runs tests, finds issues, and either **acts** (within granted scope)
  or **asks** the user.

**The principle:** always active, responding **as if a teammate messaged it — not only the user** — and replying when
something surfaces during a watch instead of waiting. Breath always operates **inside the consent contract** (see
`CONTRACT.md`): proactive action is free within approved scope, asks when it leaves scope, and never crosses a red line.

---

## 3. How Memory and Breath reinforce each other

- Breath watches; Smart Memory remembers **why** each watch matters and **what** the user already decided — so proactive
  action is informed, not noisy.
- Smart Memory keeps Breath cheap: tagged recall means the always-on heartbeat does not burn tokens re-reading
  everything on every wake.
- Together they realize the founder's intent: a system that is **always on, always learning, always moving the goal
  forward — without nagging and without forgetting.**

---

## 4. Status and placement

- **Smart Memory:** the framework exists but is **not yet wired into `decide()`**; scheduled in the memory phase
  (privacy-by-construction first). Now scoped as first-class.
- **Breath:** a first-class scoped capability as of 2026-06-16; the proactive-self-wake / always-watching behavior is a
  named build target (it sits with the shell + memory layers and the orchestration loop).
- Both honor the locked build order — the safety core comes first; memory and the proactive loop build on top of it, and
  self-improvement is built last.

---

*Related: `VISION.md` (point 15, the power dimension), `CONTRACT.md` (Breath acts inside the contract),
`RED-LINES.md` (memory may make Lilara smarter at edge cases but never softens a red line), `SCOPE.md` (placement).*
