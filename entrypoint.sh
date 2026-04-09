#!/bin/sh
set -e

# Start the Node.js server in the background
node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Start cloudflared tunnel
if [ -n "$TUNNEL_TOKEN" ]; then
  echo "[cloudflared] Starting named tunnel..."
  cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN" &
else
  echo "[cloudflared] No TUNNEL_TOKEN set, using quick tunnel..."
  cloudflared tunnel --url http://localhost:${PORT} &
fi
TUNNEL_PID=$!

# Wait for either process to exit
wait $SERVER_PID $TUNNEL_PID
