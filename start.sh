#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v docker >/dev/null 2>&1; then
  echo 'Install Docker with the Compose plugin, then run this command again.' >&2
  exit 1
fi
docker compose version >/dev/null
docker info >/dev/null
if [ ! -f .env ]; then
  (umask 077; cp .env.example .env)
  echo 'Created .env. Configure Google/Apple credentials there to enable sign-in.'
fi
mkdir -p secrets
printf '%s\n' 'Building the app and preparing the local model. The first model download can take several minutes.'
docker compose up --build -d
printf '%s\n' 'Stack started. Default address: http://localhost:13000 (or the APP_URL configured in .env).'
printf '%s\n' 'Check status: docker compose ps'
