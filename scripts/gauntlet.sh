#!/usr/bin/env bash
# Usage: npm run gauntlet
# One pass or fail verdict for loop-driven work: every check below must pass.
# Add a check by writing a function that returns 0 or 1 and listing it in CHECKS.
set -uo pipefail

cd "$(dirname "$0")/.."
mkdir -p artifacts

check_typecheck() { npm run --silent typecheck > artifacts/typecheck.log 2>&1 || { tail -n 15 artifacts/typecheck.log; return 1; }; }
check_determinism() { npx tsx scripts/check-determinism.ts > artifacts/lint.log 2>&1 || { tail -n 20 artifacts/lint.log; return 1; }; }
check_assets() { npx tsx scripts/check-assets.ts > artifacts/assets.log 2>&1 || { tail -n 20 artifacts/assets.log; return 1; }; }
check_test() { npm test --silent > artifacts/test.log 2>&1 || { tail -n 25 artifacts/test.log; return 1; }; }
check_build() { npm run --silent build > artifacts/build.log 2>&1 || { tail -n 15 artifacts/build.log; return 1; }; }

CHECKS=(check_typecheck check_determinism check_assets check_test check_build)

: > artifacts/gauntlet.txt
verdict=0
for check in "${CHECKS[@]}"; do
  if "$check"; then
    echo "PASS ${check#check_}" | tee -a artifacts/gauntlet.txt
  else
    echo "FAIL ${check#check_}" | tee -a artifacts/gauntlet.txt
    verdict=1
  fi
done

if [ "$verdict" = "0" ]; then echo "GAUNTLET PASSED" | tee -a artifacts/gauntlet.txt; else echo "GAUNTLET FAILED" | tee -a artifacts/gauntlet.txt; fi
exit "$verdict"
