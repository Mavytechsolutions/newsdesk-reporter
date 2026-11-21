#!/bin/sh
# Runs the APBJA server and takes updates from GitHub every 2 minutes.
cd /src
while true; do
  node server/server.js &
  PID=$!
  while sleep 120; do
    if ! kill -0 $PID 2>/dev/null; then echo "$(date) server stopped, restarting"; break; fi
    git fetch -q --depth 1 origin apbja-app 2>/dev/null || continue
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/apbja-app)" ]; then
      git reset -q --hard origin/apbja-app
      echo "$(date) updated to $(git rev-parse --short HEAD)"
      if ! git diff --quiet HEAD@{1} HEAD -- server/ 2>/dev/null; then kill $PID; wait $PID 2>/dev/null; break; fi
      # only the app page changed: no restart needed
    fi
  done
  sleep 2
done
