#!/usr/bin/env bash
# Usage: ./scripts/test.sh editmode|playmode|all
# Runs Unity tests in batch mode and exits with Unity's exit code.
# Set UNITY_PATH to override the editor location. Set FORCE=1 to skip the open-editor check.
set -uo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-all}"

if [ -z "${UNITY_PATH:-}" ]; then
  VERSION="$(sed -n 's/^m_EditorVersion: *//p' ProjectSettings/ProjectVersion.txt 2>/dev/null | head -n 1)"
  if [ -z "$VERSION" ]; then
    echo "Could not read the editor version from ProjectSettings/ProjectVersion.txt. Set UNITY_PATH." >&2
    exit 1
  fi
  UNITY_PATH="/Applications/Unity/Hub/Editor/$VERSION/Unity.app/Contents/MacOS/Unity"
fi

if [ ! -x "$UNITY_PATH" ]; then
  echo "Unity not found at: $UNITY_PATH" >&2
  echo "Set UNITY_PATH to your editor binary." >&2
  exit 1
fi

if [ -f Temp/UnityLockfile ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Temp/UnityLockfile exists. Batch mode cannot open a project that the editor has open." >&2
  echo "Close the editor, or run with FORCE=1 if the lock is stale." >&2
  exit 1
fi

mkdir -p artifacts

run_suite() {
  local platform="$1"
  local name
  name="$(echo "$platform" | tr '[:upper:]' '[:lower:]')"
  echo "Running $platform tests..."
  "$UNITY_PATH" -batchmode -nographics -projectPath "$PWD" \
    -runTests -testPlatform "$platform" \
    -testResults "$PWD/artifacts/$name-results.xml" \
    -logFile "$PWD/artifacts/$name.log"
  local code=$?
  if [ $code -ne 0 ]; then
    echo "$platform tests failed with exit code $code. See artifacts/$name.log and artifacts/$name-results.xml" >&2
  fi
  return $code
}

case "$MODE" in
  editmode) run_suite EditMode ;;
  playmode) run_suite PlayMode ;;
  all)
    run_suite EditMode || exit $?
    run_suite PlayMode
    ;;
  *)
    echo "Usage: $0 editmode|playmode|all" >&2
    exit 1
    ;;
esac
