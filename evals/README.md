# Evals

Auto-discovered evaluation modules for Lilara runtime quality measurement.

## Convention

Each file `evals/<name>.eval.js` must export:

```js
module.exports = {
  name:        "human-readable name",
  description: "what this eval measures",
  run: async (corpus) => ({
    passed:   number,
    failed:   number,
    total:    number,
    failures: [{ id, expected, got, note }],
  }),
};
```

The `corpus` argument is the parsed content of `tests/eval-corpus.json` — an
array of entries each with fields: `id`, `label`, `command`, `tool`,
`targetPath`, `payloadClass`, `branch`, `protectedBranch`,
`expected_action_class`, `expected_reasons`, `note`.

## Running

```bash
# Terminal summary
bash scripts/lilara-cli.sh eval run

# JUnit XML (for CI systems)
bash scripts/lilara-cli.sh eval run --junit /tmp/lilara.xml

# Original FP/FN quality gate (unchanged)
bash scripts/lilara-cli.sh eval quality
```

## Seeded evals

| File | What it measures |
|------|-----------------|
| `decision-replay.eval.js` | Action-class accuracy vs. labeled corpus — FP/FN counts |

## Adding evals

Drop a new `*.eval.js` file into this directory. `eval run` discovers it automatically.
No registration needed.
