#!/usr/bin/env bash
# Generate every starter template against THIS build of the framework, typecheck it,
# and boot it. A preset with no boot test is a preset that's already broken and
# doesn't know it — this is the check that makes five duplicated trees safe to keep.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${TMPDIR:-/tmp}/keel-templates-$$"
presets="${1:-$(ls "$root/templates")}"

cleanup() { rm -rf "$work"; }
trap cleanup EXIT

mkdir -p "$work"

echo "==> packing the framework"
# NOT $(npm pack) — the prepack script writes to stdout, so its output is not just
# the filename. Take the tarball off the disk instead.
( cd "$root" && npm pack --pack-destination "$work" >/dev/null 2>&1 )
tarball="$(ls "$work"/*.tgz | head -1)"
echo "    $(basename "$tarball")"

failed=0
for preset in $presets; do
  echo
  echo "==> $preset"
  app="$work/$preset"
  cp -R "$root/templates/$preset" "$app"

  # Exactly what the generator does: substitute the placeholders everywhere, then
  # pin the framework. (__APP_NAME__ appears in wrangler.jsonc too — a Worker name
  # must be lowercase and alphanumeric, which the raw placeholder is not.)
  node -e "
    const fs = require('fs');
    const path = require('path');
    const name = 'test-$preset';

    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.name === 'node_modules') return [];
      return e.isDirectory() ? walk(full) : [full];
    });

    for (const file of walk('$app')) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('__APP_NAME__') && !text.includes('__KEEL_VERSION__')) continue;
      fs.writeFileSync(file, text.split('__APP_NAME__').join(name).split('__KEEL_VERSION__').join('*'));
    }

    const p = '$app/package.json';
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.dependencies['@shaferllc/keel'] = 'file:$tarball';
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
  "

  ( cd "$app" && cp .env.example .env && npm install --silent --no-audit --no-fund >/dev/null 2>&1 ) || {
    echo "  install FAILED"; failed=1; continue;
  }

  ( cd "$app" && npx tsc --noEmit ) || { echo "  typecheck FAILED"; failed=1; continue; }
  echo "  typecheck ok"

  # Migrations, if the preset has any.
  if [ -d "$app/database/migrations" ]; then
    ( cd "$app" && npx tsx bin/keel.ts migrate >/dev/null 2>&1 ) || { echo "  migrate FAILED"; failed=1; continue; }
    echo "  migrate ok"
  fi

  # Boot it and make a real request. This is the part that catches a template that
  # typechecks and still dies on startup.
  port=$((3100 + RANDOM % 500))
  ( cd "$app" && APP_PORT=$port npx tsx bin/keel.ts serve >"$app/server.log" 2>&1 & echo $! > "$app/pid" )

  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 ||
       curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 1
  done

  kill "$(cat "$app/pid")" 2>/dev/null || true

  if [ "$ok" = 1 ]; then
    echo "  boots and serves ok"
  else
    echo "  BOOT FAILED"
    sed -n '1,20p' "$app/server.log" | sed 's/^/    /'
    failed=1
  fi

  # The Worker must actually BUNDLE. This is the check that catches a Node-only
  # driver (pg needs net/tls) sneaking into the edge import graph — it typechecks
  # and boots fine on Node and then dies at deploy.
  if [ -f "$app/wrangler.jsonc" ]; then
    ( cd "$app" && npx wrangler deploy --dry-run --outdir "$app/.wrangler-out" >"$app/bundle.log" 2>&1 ) \
      && echo "  worker bundles ok" \
      || { echo "  WORKER BUNDLE FAILED"; sed -n '1,15p' "$app/bundle.log" | sed 's/^/    /'; failed=1; }
  fi

  if [ -d "$app/tests" ]; then
    ( cd "$app" && npm test >/dev/null 2>&1 ) && echo "  tests ok" || { echo "  tests FAILED"; failed=1; }
  fi
done

echo
[ "$failed" = 0 ] && echo "all templates ok" || { echo "SOME TEMPLATES FAILED"; exit 1; }
