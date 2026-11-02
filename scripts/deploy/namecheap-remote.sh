#!/usr/bin/env bash
# Runs only via authenticated, host-key-pinned SSH under the cPanel account.
set -Eeuo pipefail
umask 077

operation="${1:?stage, deploy, or rollback required}"
release_id="${2:?release ID required}"
[[ "$operation" =~ ^(stage|deploy|rollback)$ ]] || { echo "Invalid operation" >&2; exit 2; }
[[ "$release_id" =~ ^[0-9]+-[0-9]+$ ]] || { echo "Invalid release identifier" >&2; exit 2; }
[[ "$HOME" == "/home/realtorstudio" ]] || { echo "Unexpected cPanel home; refusing deployment" >&2; exit 2; }

app_root="$HOME/apps/full-stack-learning-lab"
state_root="$HOME/.learning-lab"
release_root="$state_root/releases"
incoming="$state_root/incoming/$release_id"
data_file="$state_root/data/lab.sqlite"
release="$release_root/$release_id"

# All application source and account data stay outside the public document root.
[[ ! -L "$app_root" && ! -L "$state_root" && ! -L "$release_root" ]] || { echo "Unexpected directory symlink" >&2; exit 2; }
mkdir -p "$app_root" "$release_root" "$state_root/backups"
chmod 700 "$app_root" "$state_root" "$release_root" "$state_root/backups"

restart_app() {
  mkdir -p "$app_root/tmp"
  touch "$app_root/tmp/restart.txt"
}

current_release() {
  if [[ -L "$app_root/current" ]]; then
    local target
    target="$(readlink "$app_root/current")"
    [[ "$target" == "$release_root/"* ]] || { echo "Current release pointer is untrusted" >&2; exit 3; }
    printf '%s\n' "${target##*/}"
  elif [[ -e "$app_root/current" ]]; then
    echo "current exists but is not a release symlink" >&2
    exit 3
  else
    printf 'none\n'
  fi
}

switch_release() {
  local target="${1:?target release required}"
  [[ "$target" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
  [[ -d "$release_root/$target" && -f "$release_root/$target/dist/index.html" ]] || { echo "Release is missing" >&2; exit 3; }
  local temp="$app_root/.next-$target-$$"
  ln -s "$release_root/$target" "$temp"
  mv -Tf "$temp" "$app_root/current"
  restart_app
}

if [[ "$operation" == "rollback" ]]; then
  previous="$(current_release)"
  [[ "$previous" != "$release_id" ]] || { echo "Already on requested release" >&2; exit 3; }
  switch_release "$release_id"
  printf 'ROLLED_BACK_FROM=%s\n' "$previous"
  printf 'ACTIVE_RELEASE=%s\n' "$release_id"
  exit 0
fi

# CloudLinux's per-application Node environment is created by Setup Node.js App.
# Refuse a system Node mismatch; do not attempt Docker, sudo or cPanel root APIs.
venv="$HOME/nodevenv/apps/full-stack-learning-lab/24/bin/activate"
[[ -r "$venv" ]] || { echo "Configure the Node 24 application in cPanel first; no changes to production." >&2; exit 4; }
# shellcheck disable=SC1090
source "$venv"
node -e 'const v=process.versions.node.split(".").map(Number);if(v[0]!==24||v[1]<19)process.exit(1)' ||
  { echo "Node 24.19+ is required" >&2; exit 4; }
command -v npm >/dev/null || exit 4

[[ -f "$incoming/release.tar.gz" && -f "$incoming/release.tar.gz.sha256" ]] ||
  { echo "Missing staged artifact" >&2; exit 4; }
( cd "$incoming" && sha256sum -c release.tar.gz.sha256 ) >/dev/null
[[ ! -e "$release" ]] || { echo "Release identifier already exists; never overwrite immutable releases" >&2; exit 4; }

# The archive is built from an explicit allowlist in GitHub Actions.
while IFS= read -r member; do
  case "$member" in
    /*|../*|*/../*|*/..) echo "Unsafe archive path" >&2; exit 4 ;;
  esac
done < <(tar -tzf "$incoming/release.tar.gz")
mkdir -m 700 "$release"
tar -xzf "$incoming/release.tar.gz" --no-same-owner --no-same-permissions -C "$release"
[[ -f "$release/package-lock.json" && -f "$release/server/index.mjs" &&
   -f "$release/dist/index.html" && -f "$release/scripts/deploy/passenger-app.js" ]] || exit 4

# Dependency installation happens inside the immutable release, not the live directory.
( cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund )
node --check "$release/server/index.mjs"
node --check "$release/scripts/deploy/passenger-app.js"
chmod -R go-rwx "$release"
printf 'STAGED_RELEASE=%s\n' "$release_id"
if [[ "$operation" == "stage" ]]; then
  exit 0
fi

# Never deploy over the old Node.js app or initialize empty student progress.
[[ -f "$state_root/production-ready" ]] ||
  { echo "Missing operator production-ready gate. Deployment remains staged." >&2; exit 5; }
[[ -f "$data_file" && ! -L "$data_file" ]] ||
  { echo "Compatible account database must be migrated and verified before cutover." >&2; exit 5; }
if [[ -e "$app_root/app.js" ]] && ! cmp -s "$release/scripts/deploy/passenger-app.js" "$app_root/app.js"; then
  echo "Existing Passenger startup file differs; refusing to overwrite." >&2
  exit 5
fi

# Validate the expected app schema and make a consistent online backup.
backup_path="$state_root/backups/lab-before-$release_id.sqlite"
node --input-type=module - "$data_file" "$backup_path" <<'NODE'
import { DatabaseSync, backup } from 'node:sqlite';
const databasePath = process.argv[2], destination = process.argv[3];
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const query = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
  for (const name of ['users', 'sessions', 'user_progress', 'schema_migrations']) {
    if (!query.get(name)) throw new Error('Database schema is not yet migration-ready.');
  }
  await backup(db, destination);
} finally { db.close(); }
NODE
chmod 600 "$backup_path"

# Set up our own Passenger entry point only after the database backup succeeds.
if [[ ! -e "$app_root/app.js" ]]; then
  install -m 600 "$release/scripts/deploy/passenger-app.js" "$app_root/app.js"
fi
previous="$(current_release)"
switch_release "$release_id"
printf 'PREVIOUS_RELEASE=%s\n' "$previous"
printf 'ACTIVE_RELEASE=%s\n' "$release_id"
