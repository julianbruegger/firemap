#!/bin/sh
set -e

# Start the Node.js server in the background
node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Start cloudflared tunnel (quick tunnel — no account needed)
echo "[cloudflared] Starting tunnel on port ${PORT}..."
cloudflared tunnel --url http://localhost:${PORT} &
TUNNEL_PID=$!

# Wait for either process to exit
wait $SERVER_PID $TUNNEL_PID
