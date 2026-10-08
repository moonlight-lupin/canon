#!/bin/bash
# Canon - double-click to start on a Mac (Finder opens .command files in Terminal).
# The Mac twin of start-canon.bat. First run installs dependencies, imports the Bible and builds the web app;
# after an update it installs and rebuilds what changed, and the database is upgraded (a copy is kept in
# data/pre-upgrade). Machine-specific settings (e.g. export CANON_PORT=5018) go in canon.local.sh next to this
# file; it is not part of the repository. The Mac is kept awake while Canon runs.
# Canon is started again if it stops by itself (an error); closing this window or Ctrl+C stops it for good.
# Canon writes what happens to data/logs/canon-<date>.log (and the launcher to data/logs/launcher.log).
#
# Everything is inside main(), run by the last line: an update may replace this file while Canon runs, and bash
# reads a script as it goes — a function is read whole before it runs.
main() {
  cd "$(dirname "$0")" || exit 1
  printf '\033]0;Canon server\007'
  # Node.js from nodejs.org is in /usr/local/bin; Homebrew on Apple silicon puts it in /opt/homebrew/bin
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  [ -f ./canon.local.sh ] && . ./canon.local.sh
  export CANON_PORT="${CANON_PORT:-3000}"

  if ! command -v node >/dev/null 2>&1; then
    echo 'Node.js is not installed on this Mac. Install the "LTS" version from https://nodejs.org,'
    echo 'then double-click this file again.'
    echo
    read -r -p "Press Return to close this window. " _
    return 1
  fi
  # scripts/launcher.mjs does the rest: preparing Canon, starting it (keeping the Mac awake), starting it again,
  # installing updates
  node scripts/launcher.mjs
  local status=$?
  echo
  read -r -p "Press Return to close this window. " _
  return $status
}
main "$@"; exit $?
