#!/usr/bin/env bash
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

pass() { printf '  ok      %s\n' "$1"; }
fail() { printf '  ERROR   %s\n' "$1" >&2; exit 1; }

for f in \
  scripts/lilara-cli.sh \
  scripts/setup-wizard.sh \
  scripts/check-skills.sh \
  scripts/install-local.sh \
  scripts/wire-hooks.sh
 do
  [ -x "$f" ] || fail "$f is not executable"
done

pass 'core executable scripts present with execute bit'
printf '\nExecutable checks passed.\n'
