# Blueprints

Starter `lilara.config.json` templates for common project types. Copy a blueprint to your project root with `lilara init <blueprint>`.

## Available Blueprints

| Blueprint | Target project | Trust posture |
|---|---|---|
| `nextjs` | Next.js / React full-stack | balanced |
| `fastapi` | FastAPI / Python API | balanced |
| `rust-cli` | Rust CLI / systems binary | strict |
| `node-library` | Node.js / TypeScript npm library | strict |

## Usage

```bash
# Copy a blueprint to your project root
bash scripts/lilara-cli.sh init nextjs

# Overwrite an existing config
bash scripts/lilara-cli.sh init fastapi --force
```

## Customizing

After running `lilara init`, open `lilara.config.json` and adjust:
- `languages` — add or remove language domains
- `agents` — add specialist agents for your stack
- `runtime.protected_branches` — add your release branches
- `workflow.required_steps` — match your CI pipeline gates

See `schemas/lilara.config.schema.json` for the full property reference.
