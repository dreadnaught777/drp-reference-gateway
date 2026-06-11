#!/usr/bin/env bash
# Compile the Rego fixture to the WASM bundle the OPA provider loads.
#
# Dev-time dependency only (the opa CLI). Fixtures ship BOTH the .rego source
# and the compiled .wasm; this script rebuilds the .wasm from source so the two
# never drift. See build brief section 3 (Rego compilation row).
#
# Usage: bash scripts/build-rego.sh
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
rego="$here/fixtures/policy.rego"
out_wasm="$here/fixtures/policy.wasm"

if ! command -v opa >/dev/null 2>&1; then
  echo "error: opa CLI not found on PATH (needed to compile $rego)" >&2
  exit 1
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
bundle="$workdir/bundle.tar.gz"

# Build the WASM bundle with the drp/decision entrypoint.
opa build -t wasm -e drp/decision -o "$bundle" "$rego"

# The bundle is a gzipped tar carrying /policy.wasm (plus data.json and a
# .manifest). Extract and lift out just the wasm module.
tar -xzf "$bundle" -C "$workdir"
cp "$workdir/policy.wasm" "$out_wasm"

echo "wrote $out_wasm"
