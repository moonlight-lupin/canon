#!/bin/bash
# Canon - double-click to start on a Mac (Finder opens .command files in Terminal).
# The Mac twin of start-canon.bat. First run installs dependencies, imports the Bible and builds the web app;
# after an update it installs and rebuilds what changed, and the database is upgraded (a copy is kept in
# data/pre-upgrade). Machine-specific settings (e.g. export CANON_PORT=5018) go in canon.local.sh next to this
# file; it is not part of the repository. The Mac is kept awake while Canon runs.
cd "$(dirname "$0")" || exit 1
printf '\033]0;Canon server\007'
# Node.js from nodejs.org is in /usr/local/bin; Homebrew on Apple silicon puts it in /opt/homebrew/bin
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f ./canon.local.sh ] && . ./canon.local.sh
export CANON_PORT="${CANON_PORT:-3000}"

finish() {
  echo
  read -r -p "Press Return to close this window. " _
}

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is not installed on this Mac. Install the "LTS" version from https://nodejs.org,'
  echo 'then double-click this file again.'
  finish
  exit 1
fi
# Installs dependencies and rebuilds the web app when Canon was updated; refuses a too-old Node.js.
if ! node scripts/startup-check.mjs; then
  echo 'Something went wrong - see the messages above. Your data has not been changed.'
  finish
  exit 1
fi
if [ ! -f data/canon.db ]; then
  npm run import:bible || { echo 'The Bible could not be imported - see the messages above.'; finish; exit 1; }
fi
export NODE_ENV=production

# this Mac's address on the office network (else its name)
LAN="$(node scripts/lan-address.mjs | head -n 1)"
[ -n "$LAN" ] || LAN="$(scutil --get LocalHostName 2>/dev/null).local"
echo
echo "Canon is starting. Open http://localhost:$CANON_PORT on this Mac,"
echo "or http://$LAN:$CANON_PORT from other computers on the office network."
echo 'Keep this window open while Canon is in use.'
echo

# caffeinate keeps the Mac from sleeping (and taking Canon offline) for as long as Canon runs.
# Canon is started again if it stops by itself (an error); closing this window or Ctrl+C stops it for good.
# Canon writes what happens to data/logs/canon-<date>.log.
restarts=0
while true; do
  if command -v caffeinate >/dev/null 2>&1; then
    caffeinate -is npm start && break
  else
    npm start && break
  fi
  status=$?
  # Ctrl+C (130) or a closed window: stop for good
  [ "$status" -ge 128 ] && break
  restarts=$((restarts + 1))
  if [ "$restarts" -gt 10 ]; then
    echo 'Canon stopped unexpectedly 10 times, so it was not started again. See data/logs for why.'
    break
  fi
  echo
  echo 'Canon stopped unexpectedly. Starting it again in 10 seconds (see data/logs for why)...'
  [ -d data/logs ] && echo "$(date) Canon stopped unexpectedly and was started again" >> data/logs/launcher.log
  sleep 10
done
echo
echo 'Canon has stopped.'
finish
