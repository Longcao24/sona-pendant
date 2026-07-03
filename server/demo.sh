#!/bin/bash
# One-command demo start: prints the server URL for the app, then runs the server.
# Usage:  ./demo.sh   (from the server/ directory — or anywhere)
cd "$(dirname "$0")"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "════════════════════════════════════════════════════"
if [ -n "$IP" ]; then
  echo "  Put this URL in the app (Settings ▸ Detection Server):"
  echo ""
  echo "      http://$IP:8000"
  echo ""
  echo "  (phone must be on the same Wi-Fi as this Mac)"
else
  echo "  ⚠ No Wi-Fi IP found — connect this Mac to Wi-Fi first."
fi
echo "════════════════════════════════════════════════════"

exec .venv/bin/python app.py
