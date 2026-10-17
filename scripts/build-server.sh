#!/usr/bin/env bash
# Builds the headless Linux dedicated server used for CI and soak tests.
# Output goes to Builds/LinuxServer/. Needs the Linux Dedicated Server build module installed in Unity Hub.
set -uo pipefail

cd "$(dirname "$0")/.."

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
  exit 1
fi

if [ -f Temp/UnityLockfile ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Temp/UnityLockfile exists. Close the editor, or run with FORCE=1 if the lock is stale." >&2
  exit 1
fi

mkdir -p artifacts Builds/LinuxServer

"$UNITY_PATH" -batchmode -nographics -quit -projectPath "$PWD" \
  -buildTarget Linux64 -standaloneBuildSubtarget Server \
  -executeMethod BuildScript.BuildServer \
  -logFile "$PWD/artifacts/build-server.log"
CODE=$?

if [ $CODE -ne 0 ]; then
  echo "Server build failed with exit code $CODE. See artifacts/build-server.log" >&2
fi
exit $CODE
