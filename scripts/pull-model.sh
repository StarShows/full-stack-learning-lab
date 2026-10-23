#!/bin/sh
set -eu
case "$OLLAMA_MODEL" in *cloud*|*..*|'') echo 'Choose a local model tag.' >&2; exit 1;; esac
export OLLAMA_HOST=127.0.0.1:11434
ollama serve &
model_server_pid=$!
trap 'kill "$model_server_pid" 2>/dev/null || true' EXIT INT TERM
attempt=0
until ollama list >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then echo 'Model download service did not start.' >&2; exit 1; fi
  sleep 1
done
if ! ollama show "$OLLAMA_MODEL" >/dev/null 2>&1; then
  ollama pull "$OLLAMA_MODEL"
fi
