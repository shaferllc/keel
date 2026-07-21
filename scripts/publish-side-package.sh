#!/usr/bin/env bash
#
# Publish one of the side packages (create-keeljs, keel-mcp) from its own
# directory, during a framework release.
#
# These used to carry `continue-on-error: true`, which was the wrong tool. It
# made every outcome look the same: keel-mcp had never been created on the
# registry, so its publish 404'd on every single release, and because the step
# could not fail, the job stayed green with a red X buried in the annotations.
# A failure that cannot fail the build is a failure nobody reads — and it also
# meant a *genuine* publish regression in create-keeljs would have been just as
# invisible.
#
# So this distinguishes the three cases instead:
#
#   already published  → skip, quietly. Side packages are versioned independently
#                        of the framework, so most release tags publish nothing
#                        here, and that is the normal path, not a problem.
#   not on npm at all  → warn and skip. Trusted publishing mints its credential
#                        from this workflow's OIDC identity, which npm can only
#                        check against a package that already exists and names
#                        this workflow as its trusted publisher. A package that
#                        has never been published has nothing to check, so the
#                        first one has to come from a maintainer. That is a
#                        provisioning gap, not a broken build.
#   anything else      → fail the job, loudly.
set -euo pipefail

name="$(node -p 'require("./package.json").name')"
version="$(node -p 'require("./package.json").version')"

if npm view "${name}@${version}" version >/dev/null 2>&1; then
  echo "${name}@${version} is already on npm — nothing to do."
  exit 0
fi

if ! npm view "${name}" version >/dev/null 2>&1; then
  echo "::warning title=${name} is not on npm yet::Skipping. Trusted publishing \
cannot create a package that has never been published, because there is no \
trusted-publisher configuration to check this workflow against. Bootstrap it \
once from packages/${name} with 'npm publish --access public' (you will need \
2FA), then add this workflow as its trusted publisher on npmjs.com. After that \
this step keeps it current on its own."
  exit 0
fi

echo "Publishing ${name}@${version}…"
npm publish --access public
echo "::notice::Published ${name}@${version}"
