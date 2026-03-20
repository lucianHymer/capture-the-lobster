#!/bin/bash
# Auto-restart wrapper for the game server
cd /home/lucian/workspace/capture-the-lobster

while true; do
  echo "[$(date)] Starting server..." >> /tmp/ctf-server.log
  PORT=5173 node packages/server/dist/index.js >> /tmp/ctf-server.log 2>&1 &
  NODE_PID=$!
  wait $NODE_PID
  EXIT_CODE=$?
  # Decode signal: if exit code > 128, process was killed by signal (exit_code - 128)
  if [ $EXIT_CODE -gt 128 ]; then
    SIGNAL=$((EXIT_CODE - 128))
    echo "[$(date)] Server killed by signal $SIGNAL (exit code $EXIT_CODE)" >> /tmp/ctf-server.log
    echo "[$(date)] Server killed by signal $SIGNAL (exit code $EXIT_CODE)" >> /tmp/ctf-crash.log
  else
    echo "[$(date)] Server exited with code $EXIT_CODE" >> /tmp/ctf-server.log
    echo "[$(date)] Server exited with code $EXIT_CODE" >> /tmp/ctf-crash.log
  fi
  echo "[$(date)] Restarting in 2 seconds..." >> /tmp/ctf-server.log
  sleep 2
done
