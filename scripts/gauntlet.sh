#!/usr/bin/env bash
# Usage: ./scripts/gauntlet.sh
# One pass/fail verdict for loop-driven work: every check below must pass.
# Add a new check by writing a function that returns 0 or 1 and listing it in CHECKS.
# Results are in artifacts/. Exit code 0 means the whole gauntlet passed.
set -uo pipefail

cd "$(dirname "$0")/.."
mkdir -p artifacts

if pgrep -fi "unity.app/Contents/MacOS/Unity.*-projectpath $PWD( |$)" >/dev/null; then
  echo "The Unity editor has this project open. Close it first." >&2
  exit 2
fi

# A lock file with no editor running is left over from a crashed run.
export FORCE=1

count() { grep -oE "$2=\"[0-9]+\"" "$1" 2>/dev/null | head -n 1 | grep -oE '[0-9]+'; }

run_suite() {
  local mode="$1"
  local results="artifacts/$mode-results.xml"
  # Old results would hide a crash or a compile error, so clear them first.
  rm -f "$results"
  ./scripts/test.sh "$mode" >/dev/null 2>&1
  local unity_exit=$?
  local total passed failed
  total="$(count "$results" total)"
  passed="$(count "$results" passed)"
  failed="$(count "$results" failed)"
  if [ -z "$total" ]; then
    echo "$mode: no results, probably a compile error. See artifacts/$mode.log"
    grep -E "error CS" "artifacts/$mode.log" 2>/dev/null | sort -u | head -n 5
    return 1
  fi
  echo "$mode: $passed of $total passed, $failed failed"
  [ "$unity_exit" = "0" ] && [ "$failed" = "0" ] && [ "$total" != "0" ]
}

check_editmode() { run_suite editmode; }
check_playmode() { run_suite playmode; }

CHECKS=(check_editmode check_playmode)

for check in "${CHECKS[@]}"; do
  if "$check"; then
    echo "PASS ${check#check_}"
  else
    echo "FAIL ${check#check_}"
  fi
done | tee artifacts/gauntlet.txt
# The loop above runs in a subshell because of the pipe, so read the verdict from the file.
if grep -q '^FAIL' artifacts/gauntlet.txt; then
  echo "GAUNTLET FAILED" | tee -a artifacts/gauntlet.txt
  exit 1
fi
echo "GAUNTLET PASSED" | tee -a artifacts/gauntlet.txt
