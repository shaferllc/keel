#!/usr/bin/env bash
# Build from what is actually COMMITTED, not from the working tree.
#
# `npm test` and `npm run typecheck` both run against your working directory, so
# they cannot see a file you forgot to commit — or one you committed half-written.
# A git install runs `npm run build` through `prepare`, so a broken tree there means
# the package simply cannot be installed. That is how v0.74.0–v0.74.2 shipped
# unusable.
#
# This exports HEAD to a temp dir and does the install + build a consumer would.
set -euo pipefail

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

echo "→ exporting HEAD to $dir"
git archive HEAD | tar -x -C "$dir"

cd "$dir"
echo "→ npm install (with scripts — this is what a git install does)"
npm install --silent --no-audit --no-fund

echo "✓ the committed tree installs and builds"
