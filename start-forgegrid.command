#!/bin/zsh

set -u

project_dir="${0:A:h}"
cd "$project_dir" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "ForgeGrid needs Node.js 22 or newer."
  echo "Install it from https://nodejs.org, then open this file again."
  read -r "?Press Return to close."
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "ForgeGrid needs Node.js 22 or newer. Found Node.js $(node --version)."
  read -r "?Press Return to close."
  exit 1
fi

npm start &
server_pid=$!

cleanup() {
  if kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1
  fi
}
trap cleanup INT TERM EXIT

for attempt in {1..80}; do
  if curl --silent --fail http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    open http://127.0.0.1:8000
    break
  fi
  if ! kill -0 "$server_pid" >/dev/null 2>&1; then
    echo "ForgeGrid could not start. Review the message above."
    read -r "?Press Return to close."
    exit 1
  fi
  sleep 0.1
done

wait "$server_pid"
