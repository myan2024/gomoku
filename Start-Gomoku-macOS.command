#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed or is not available on PATH."
  echo "Opening the official Node.js download page..."
  open "https://nodejs.org/en/download"
  read -r -p "Install the macOS LTS package, then double-click this file again. Press Return to close."
  exit 1
fi
if [ ! -d "node_modules/socket.io" ]; then
  echo "Installing Gomoku dependencies. This may take a minute..."
  npm install || { read -r -p "Installation failed. Press Return to close."; exit 1; }
fi
echo "Starting Gomoku server..."
npm start &
SERVER_PID=$!
sleep 3
open "http://localhost:3000"
echo "The game should open in your browser. Keep this Terminal window open while playing."
wait "$SERVER_PID"
read -r -p "The server has stopped. Press Return to close."
