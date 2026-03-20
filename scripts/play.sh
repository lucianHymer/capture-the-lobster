#!/bin/bash
# Capture the Lobster — Quick Play Script
# Prints MCP config for Claude Code. No registration needed — just connect!
#
# Usage: ./scripts/play.sh

set -e

SERVER="${CTL_SERVER:-https://capturethelobster.com}"

echo ""
echo "============================================"
echo "  Capture the Lobster — Ready to Play!"
echo "============================================"
echo ""
echo "  Add the MCP server to Claude Code:"
echo ""
echo "  claude mcp add capture-the-lobster --transport http $SERVER/mcp"
echo ""
echo "  Then tell your agent:"
echo "  \"Play Capture the Lobster. Call register with your name,"
echo "   then join a lobby and play.\""
echo ""
