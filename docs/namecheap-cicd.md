# Namecheap shared-hosting CI/CD for Full Stack Learning Lab

## Current status and boundary

GitHub Actions in this repository already run build, automated tests, browser-runner checks, a container smoke test and local-inference checks. The separate `deploy-namecheap.yml` workflow stages immutable release archives, installs production dependencies using CloudLinux's Node 24 environment and can signal Passenger to restart. **This workflow is not active for production by default.**

This GitHub repository is a **different deployment shape** from the currently running cPanel app, which was started with `app.js` loading `runtime/main.mjs`. The source release uses `server/index.mjs`, `dist/`, database migrations and a standalone SQL store. There is no verified migration between these deployments. Do not treat successful GitHub CI as proof that their databases or account identifiers are compatible. Do not overwrite the existing cPanel app root, `.env`, OAuth secrets or account data.

The workflow intentionally uses a new app root outside the document root:

| Component | Location |
| --- | --- |
| New cPanel Node.js application root | `/home/realtorstudio/apps/full-stack-learning-lab` |
| Immutable release versions | `/home/realtorstudio/.learning-lab/releases/` |
| Incoming verified archives | `/home/realtorstudio/.learning-lab/incoming/` |
| Persistent SQLite and optional WAL | `/home/realtorstudio/.learning-lab/data/lab.sqlite` |
| Pre-deployment database backups | `/home/realtorstudio/.learning-lab/backups/` |
| Stable Passenger startup entry | `/home/realtorstudio/apps/full-stack-learning-lab/app.js` |
| Active release pointer | `/home/realtorstudio/apps/full-stack-learning-lab/current` |

The prior cPanel application root at `/home/realtorstudio/alext.io/public/sites/learning-lab` is **not** touched by the workflow. Keep the existing copy as a rollback option during migration. If its files are directly web-accessible through the old `/public/sites/` URL, protect them from public download.

## One-time cPanel setup

1. In cPanel **Setup Node.js App**, create a separate application using **Node.js 24.19+** (or the latest available compatible Node 24), Production mode, application root `apps/full-stack-learning-lab`, and startup file `app.js`. For safe initial testing, use a temporary URL such as `https://alext.io/learn-preview` if cPanel allows it. Do not steal the active `/learn` mapping until cutover.
2. Confirm that the Node virtual environment activation script is at `/home/realtorstudio/nodevenv/apps/full-stack-learning-lab/24/bin/activate`. The remote deployment deliberately refuses to use an unverified system Node or attempt root/WHM operations. If cPanel assigns a different path, adjust the deployment script through a reviewed PR.
3. In the new cPanel application, set `APP_URL=https://alext.io` and `APP_BASE_PATH=/learn-preview` when testing preview, then `APP_BASE_PATH=/learn` at final cutover. Set `DATABASE_PATH` to a **separate preview database** initially, then the intended persistent path after migration. Set OAuth variables only through cPanel protected environment settings, never inside this public repository. Do not set `APP_URL` to `https://alext.io/learn`: it must be an HTTPS **origin** without a path.
4. Use Node's own reverse port binding through Passenger. The server creates a single HTTP server. Do **not** separately expose port 13000 or open a new firewall rule. cPanel/Passenger restarts the app after `tmp/restart.txt` is touched.
5. Ensure this directory has no public static route. Source files, SQLite, session keys and backups must never live under the public document root or be accessible through an Apache alias.

Reference: [Namecheap: How to work with Node.js App](https://www.namecheap.com/support/knowledgebase/article.aspx/10047/2182/how-to-work-with-nodejs-app/), [cPanel: restart via tmp/restart.txt](https://support.cpanel.net/hc/en-us/articles/1500002443862-How-to-restart-an-application-that-s-using-cPanel-s-Application-Manager), and [Passenger reverse port binding](https://www.phusionpassenger.com/docs/advanced_guides/in_depth/node/reverse_port_binding.html).

## Host limitations and tutor service

Namecheap shared hosting can run the **Node application** using cPanel, but its shared-hosting policy prohibits arbitrary standalone background daemons and has resource limits. Do not run a private Ollama/model process or the Docker Compose stack on shared hosting. The project's deterministic lessons, account progress and normal web routes do not need a model; **the optional tutor cannot work in its default local Ollama mode there** unless a separately hosted, authenticated inference service is configured and tested. This is an explicit parity gap, not a CI/CD failure.

If you already operate an authorized private HTTPS inference gateway elsewhere, the application has `LLM_MODE=token`, `LLM_ENDPOINT`, `LLM_MODEL`, and a protected `LLM_TOKEN` environment setting. Validate its TLS trust, access controls, response limits, availability and cost or resource implications before enabling it. Do not put model keys or tokens in GitHub or browser bundles, and do not loosen the existing local model URL allowlist. See [Namecheap shared-hosting resource restrictions](https://www.namecheap.com/support/knowledgebase/article.aspx/157/22/do-you-have-any-server-resource-restrictions/).

For the final `/learn` mapping, verify the registered OAuth callbacks are exactly `https://alext.io/learn/auth/google/callback` (and `https://alext.io/learn/auth/apple/callback` if Apple is enabled). OAuth identity binding and saved progress must be checked with actual logged-in users after cutover.

## GitHub repository environment

In `StarShows/full-stack-learning-lab`, go to **Settings > Environments > production**. Restrict deployments to the protected `main` branch; add an independent required reviewer if available. Limit who can change the deployment configuration. Set these environment variables:

| Variable | Expected value |
| --- | --- |
| `NC_LAB_SSH_HOST` | Verified Namecheap SSH hostname, not guessed |
| `NC_LAB_SSH_PORT` | Verified SSH port number |
| `NC_LAB_SSH_USER` | `realtorstudio` |
| `NC_LAB_ACTIVATE_ENABLED` | `false` until compatibility and data migration are verified |

In **Settings > Secrets and variables > Actions > Variables** (repository-level, not environment-level), set `NC_LAB_AUTO_DEPLOY=false`. GitHub evaluates a job's `if` before injecting environment-scoped variables, so this toggle must be a repository variable. Keep it false until the first production deploy and recovery drill pass.

Environment **secrets** (not variables):

| Secret | Purpose |
| --- | --- |
| `NC_LAB_SSH_PRIVATE_KEY` | Dedicated deployment-only SSH private key |
| `NC_LAB_SSH_KNOWN_HOSTS` | Verified, pinned SSH host key entry |

Use a dedicated Ed25519 SSH key rather than giving Actions your main login key or an account password. Authorize its public half for the cPanel user, preferably with a server-side command restriction or narrow account permissions when your host supports it. Confirm the SSH host key fingerprint through a separate, trusted channel. Never trust an unverified `ssh-keyscan` result just because a key was returned. Do not paste private key material into issues, pull requests or chat.

Use GitHub branch protection/rulesets to require successful CI checks and a deliberate merge into `main`. Disable automatic pull-request merges until you choose otherwise. Public-repo PRs never receive deployment secrets here: the workflow uses `push` to `main` or a manual main-branch dispatch, not `pull_request_target`.

## Stage a release without changing production

1. Merge the reviewed deployment PR into `main` after CI passes. **Merging alone will not deploy** while `NC_LAB_AUTO_DEPLOY` is false.
2. Open **Actions > Deploy Learning Lab to Namecheap > Run workflow**, select branch `main`, operation `stage`. This downloads no user data and does not change the cPanel startup file, active symlink, production variables, or active process.
3. The GitHub runner builds and tests using Node 24, checks production dependency advisories, creates an explicit archive, and uploads it with SHA-256 checksum. Over pinned SSH it transfers the artifact to `.learning-lab/incoming/`; the Namecheap script verifies the checksum, unpacks to an immutable release directory and runs `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` inside the new release.
4. Inspect the stage run. Its immutable release ID is `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT`. A fresh stage run does not take down `https://alext.io/learn`.

For separate preview testing, point the new cPanel app to a preview URL with preview environment variables and a **copied, isolated test database**. Manually install the reviewed stable `scripts/deploy/passenger-app.js` as `app.js`, point its `current` symlink to the staged release, and restart that *preview* cPanel app. Test assets, lessons, login and progress there. Never use the production DB simultaneously from multiple app processes or different hosts.

## Database migration and explicit production gate

The old app's database location and schema have **not been verified** via SSH. Before activation, an operator must:

1. Discover and securely back up the actual live SQLite database, including a consistent snapshot while it is online. The file might be at `.../learning-lab/data/lab.sqlite`, but do **not** assume this. Do not copy only the `.sqlite` file while WAL writes are active; use SQLite's online backup API or stop the old app.
2. Place a compatible, validated migration at `/home/realtorstudio/.learning-lab/data/lab.sqlite` with permissions 600; the data directory should be 700. The new release requires `users`, `sessions`, `user_progress` and `schema_migrations`. Its migration checksums must match and account ownership must be verified. Do not silently merge users by email.
3. Test an offline clone of the resulting DB and confirm the original user's saved lessons survive, OAuth identities are correct and no account data is lost. Preserve an offline, encrypted copy that is not writable by CI.
4. Switch the cPanel application URL to `/learn`, configure `APP_BASE_PATH=/learn` and `DATABASE_PATH=/home/realtorstudio/.learning-lab/data/lab.sqlite`, and verify HTTPS and correct Google/Apple OAuth callback URLs. Coordinate removing the old `/learn` rewrite/mapping. Do not simultaneously leave both apps handling the same URL.
5. Only then create the operator gate file `/home/realtorstudio/.learning-lab/production-ready` (owner-only permissions) and set environment variable `NC_LAB_ACTIVATE_ENABLED=true` in GitHub.

The script refuses activation without that operator gate and an existing compatible database. It makes an online, private database backup and runs target schema migrations against a disposable copy **before** changing the release pointer. The script does not delete the old app, DB, or other releases.

For **the first production activation**, run the workflow manually with operation `deploy`. Its HTTPS checks verify `/learn/health/ready`, anonymous session isolation, `/learn/` base-path markup, and worker assets. Verify real OAuth login and retained progress manually afterward. Only after that should you set `NC_LAB_AUTO_DEPLOY=true` if automatic deploys after approved main merges are wanted.

## Restart, rollback, and retention

The deployment installs Node production dependencies inside a versioned release, then atomically switches the `current` symlink and touches `apps/full-stack-learning-lab/tmp/restart.txt`. Passenger notices this on the next request and reloads the process; GitHub performs an HTTPS smoke test. This does **not** restart Apache, mutate cPanel configuration, or install a new Node version.

On a failed smoke test the workflow attempts to restore the previous release pointer if one exists. Manual rollback is available in **Actions**, operation `rollback`, with the last known-good release ID. Rollback also requires the server-side production gate, an existing active release, and an `.activated` marker written only by the reviewed deploy operation, so a merely staged release can never be activated by misusing rollback. Rollback switches only application code. It does **not** automatically revert SQLite schema/data; database migrations must be backward-compatible, and a restore from the saved private backup may require stopping the app and operator review.

Release archives in GitHub expire after seven days; immutable server releases and backups remain until the owner explicitly removes them. Introduce retention once successful deployments, storage limits, and restore procedures are verified. If the first cutover fails and no previous GitHub-managed release exists, restore the original cPanel application URL/root manually instead of risking student progress.

## Security and maintenance checks

- No secrets, environment files, SSH key or SQLite data are packaged, committed or sent to GitHub.
- Actions permissions are read-only; dependencies install from a lockfile; checkout/setup actions use pinned SHAs; SSH never disables host key verification.
- Only a manual dispatch from `main`, or a guarded push to `main`, reaches the production environment. The default behavior is stage-only or skip, not live deployment.
- Production source, account data and backups are outside the public web root. A single Node/Passenger process owns the SQLite DB.
- Monitor GitHub Actions, Namecheap Passenger logs and disk usage. Periodically test encrypted backup restoration.
- Audit outgoing OAuth and push services separately. A successful health check cannot prove real-provider OAuth, notification delivery, or the correctness of a historical data migration.
