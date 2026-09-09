#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 LTS: https://nodejs.org/'
  exit 1
fi
node scripts/launch.mjs "$@"
