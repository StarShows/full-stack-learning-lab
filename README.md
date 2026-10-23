# Full Stack Learning Lab

A self-hosted learning app with 28 guided lessons in JavaScript, React, Express, and Sequelize. It includes an optional timed practice lab, persistent per-user progress, Google and Apple sign-in, and a private local coding tutor.

## Start everything with one command

Install Docker with Compose, clone this repository, and run:

```sh
./start.sh
```

The command builds the app, creates persistent volumes, downloads the default model once, and starts the complete stack. Open **http://localhost:13000** by default. The first download is about 1.9 GB for the model, plus container images. Later starts reuse the downloaded model and your progress.

The script creates a private `.env` from `.env.example` on the first run. You must configure Google and/or Apple developer credentials in that file to enable sign-in. The app never substitutes a fake login when credentials are missing. Both provider buttons are shown; unconfigured providers are disabled with an explanation.

**One command starts the software. It cannot register OAuth clients or obtain developer-account credentials for you.** Follow [authentication setup](docs/authentication.md), then run the same command again.

## What runs locally

| Component | Runtime | Persistence |
| --- | --- | --- |
| Web app, API, sessions, progress | One Node.js application container | SQLite in `lab-data` |
| Code checks and interactive preview | Isolated browser Web Worker | Results saved to the signed-in user's progress |
| Optional lesson tutor | Ollama with `qwen2.5-coder:3b` | Model weights in `model-data` |
| Model provisioning | Temporary download container | Downloads into `model-data`, then exits |

The exercise runner is deterministic JavaScript, not an LLM. It stays separate from tutoring so grading is repeatable. The model offers small hints; it never grades submissions, executes shell commands, or accesses user accounts or files.

The default CPU setup works without a GPU. Budget approximately 8 GB of free RAM for the stack; speed depends on the host. The runtime limits Ollama to 6 GB. Use a larger model only after adjusting host resources and the configured memory limit. Docker on Apple Silicon does not expose Metal acceleration to Linux containers; fully containerized inference uses the CPU there. Native host acceleration is a separate deployment choice.

## Privacy and authentication

Prompts go from the browser to your application server and then to Ollama on the same host. The inference container has no public port and joins an internal Docker network without external egress. Cloud inference is disabled. Only the temporary model downloader needs registry access. Google/Apple sign-in still requires internet access to those providers.

Sessions use opaque random tokens, stored as hashes in SQLite and sent in HttpOnly cookies. HTTPS deployments use Secure cookies. OAuth uses one-time, browser-bound state and nonce validation; Google also uses PKCE. Tokens are verified against the provider's signing keys, issuer, audience and expiry. Google and Apple identities are separate accounts, even if their email addresses match. Automatic email-based linking is deliberately unsupported.

Every progress operation uses the authenticated session. Writes enforce same-origin requests, bounded JSON bodies, and revision checks that reject stale updates. Tutor requests are authenticated, bounded, rate-limited, limited to two concurrent generations, and time out after three minutes. Model text is rendered as plain text.

## Operating the stack

```sh
# Status and logs
docker compose ps
docker compose logs --tail=100 app ollama

# Stop without deleting progress or models
docker compose down

# Start again or rebuild after updating source
./start.sh

# Optional Linux/NVIDIA GPU, after installing the NVIDIA Container Toolkit
docker compose -f compose.yaml -f compose.gpu.yaml up --build -d
```

The default app port is bound to loopback. For remote access, put an HTTPS reverse proxy in front of it, preserve the original `Host` header, and set `APP_URL` to that exact HTTPS origin. Apple requires a registered HTTPS domain; localhost is not accepted. See [operations](docs/operations.md) for backups, model changes, and deployment boundaries.

There is no public inference endpoint, agent gateway, hosted model SDK, or platform-specific authentication dependency. No external orchestration agent is needed for this app.

## Development and verification

Requires Node.js 24.19 or later:

```sh
npm ci
npm run build
npm test
npm start
```

For native Node development, set `DATABASE_PATH` and `APP_URL` in `.env`, and set `OLLAMA_URL=http://localhost:11434` if a local Ollama daemon is running. Docker overrides that address to its private service.

The server uses immutable, checksummed SQL migrations in `db/migrations/`. Append a migration for schema changes; never edit an applied migration. Startup applies pending migrations transactionally before accepting traffic.

The test suite covers signed identity-token verification, authorization-code callbacks, replay and browser binding, expiry, session revocation, account isolation, SQLite persistence, request limits, tutor failures, UI save/retry flows, and all lesson and practice runners. CI builds the actual container and starts the full Compose stack to smoke-test local inference. Provider tests use locally signed fixtures, not real provider credentials. Complete real Google/Apple acceptance testing after registering your own OAuth clients.

This release is a standalone server deployment. It does not change any separately hosted copy or automatically move that copy's account data. Browser-only legacy progress can still be imported explicitly. Hosted account progress needs an authenticated export and deliberate identity mapping before migration.

Original practice material only. Close the app before a real proctored assessment.
