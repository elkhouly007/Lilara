# F27 Consent Calibration Report

Date: 2026-06-21
Branch: feat/f27-calibration-evidence
Scope: PR-B calibration evidence for the F27 consent posture

## Method

- Generated `tests/fixtures/replay-corpus/secret-egress-consent-adversarial.jsonl` with 14 entries:
  - 10 positive probes that should fire F27 under `LILARA_F27_CONSENT=1`
  - 4 negative probes that should not fire F27
- Ran `node --test tests/runtime/floor-f27-calibration.test.js`
- The test harness forces the consent posture with and without a controlling TTY and checks:
  - positive probes escalate to `secret-egress-consent-required`
  - negative probes do not fire F27
  - positive probe `irHash` values stay byte-stable
  - no-TTY remains fail-closed (`secret-egress-consent-no-tty`)

## Local Results

- Corpus generation: 14 passed, 0 failed
- Runtime calibration test: 9/9 subtests passed
- Positive probes under consent+TTY: zero FN
- Negative probes under consent+TTY: zero FP
- No-TTY path: block/fail-closed, distinct decisionSource preserved

## Evidence

- Corpus file: `tests/fixtures/replay-corpus/secret-egress-consent-adversarial.jsonl`
- Runtime test: `tests/runtime/floor-f27-calibration.test.js`
- Generator: `tests/fixtures/replay-corpus/build-secret-egress-consent-adversarial.js`

## Notes

- This report records local calibration evidence only.
- OpenClaw/Hermes external calibration runs are still separate reviewer evidence and should be attached before PR-C lock/flip.
- The consent posture is additive and does not mutate the existing secret-egress adversarial corpus.
