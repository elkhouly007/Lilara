# F27 Reclassification Decision Record

Date: 2026-06-21
Branch: feat/f27-reclassification
Change: Reclassify F27 (secret-egress-external) from inviolable to demotable.

## Owner sign-off

- Approved by: Ahmed Elkhouly
- Authority basis: explicit PR-C approval in the active Lilara execution thread
- Scope: F27 only; no change to the consent transport implementation; no change to other inviolable floors

## What changed

- F27 tier changed from `inviolable` to `demotable`
- F27 `demotableBy` changed from `[]` to `["consent:interactive"]`
- F27 `action` changed from `block` to `escalate`
- `INVIOLABLE_FLOOR_IDS` shrank from 22 to 21 entries
- `artifacts/lattice-baseline.sha256` was rebaselined accordingly

## Why this is valid

- The consent path is still human-only and fail-closed on no-TTY.
- The replay corpus remains byte-stable at canonical posture.
- The reclassification encodes the already-approved owner decision, rather than inventing a new security rule.

## Review prerequisites before merge

- OpenClaw review: pending
- Sanad review: pending
- Do not merge until both reviews approve.
