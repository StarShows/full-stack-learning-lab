# Operations and architecture decisions

## Deployment shape

This is a modular monolith for the application and a separate local inference process. One Compose command starts both. Combining the application server and model runtime into one process/container would couple memory pressure, health checks, restarts, and permissions without improving the user experience.

The application owns authentication, authorization, per-user progress, request limits, and the tutoring boundary. SQLite is appropriate for one host and a modest learning workload. Use one application replica with a local volume. Do not place SQLite on a network filesystem or pretend this is a horizontally scaled service. Move to a server database before that requirement emerges.

## Network boundaries

- `app`: loopback host port by default; joins the egress and private inference networks. OAuth requires egress.
- `ollama`: internal network only; no host port; model volume is read-only; no outbound internet route.
- `model-pull`: egress network only; downloads missing weights, then exits. It is not a proxy for inference.
- Browser exercise Workers receive a policy denying network access. They do not run code on the server.

Reverse proxies should preserve `Host`, enforce HTTPS, limit request sizes, and enforce deployment-specific ingress limits. Forwarded identity headers are ignored. The server uses its configured origin, never a forwarded host, to generate authentication callbacks. The built-in peer-address rate limits are deliberately coarse; behind a proxy, all users may share the proxy's quota. Configure per-client limits at the proxy rather than trusting unvalidated forwarded addresses.

## Persistence and backups

`lab-data` stores the SQLite database, WAL, sessions, OAuth transactions and progress. `model-data` stores model weights. These are Docker-managed volumes with project-scoped names. `docker compose down` preserves them; **`docker compose down -v` permanently removes them**.

Use the SQLite online backup API for a consistent backup while the app is running:

```sh
docker compose exec -T app node --input-type=module -e 'import { DatabaseSync, backup } from "node:sqlite"; const db=new DatabaseSync("/data/lab.sqlite"); await backup(db,"/data/lab-backup.sqlite"); db.close();'
docker compose cp app:/data/lab-backup.sqlite ./lab-backup.sqlite
```

Backups contain private account and session data. Protect them like credentials and keep them out of Git. Restore only to a stopped application and retain the original until the restored copy is verified. The app requires the exact migration checksums that were applied to the backup.

## Model changes

Set `OLLAMA_MODEL` in `.env`, adjust `mem_limit` if needed, and recreate the provisioning job before restarting inference:

```sh
docker compose stop ollama
docker compose rm -f model-pull
docker compose up -d model-pull
docker compose up -d --force-recreate ollama app
```

The provisioning job preserves an existing local model; it does not silently refresh weights on every launch. For reproducibility, record the model's digest from `docker compose exec ollama ollama list`. Container versions are pinned by release tag; production operators should additionally pin images by verified digest for their architecture. Models and container images are separate supply-chain artifacts.

The default model is intentionally small. CPU speed, model quality, and memory use are tradeoffs. A larger model does not change exercise correctness because model output is never used as a test oracle. The model has no tools, shell, filesystem API, arbitrary URL input, or other users' progress. It can still return incorrect explanations, so the UI explicitly directs learners to verify suggestions with the deterministic tests.

## Health and failures

`/health/live` reports that the HTTP process responds; `/health/ready` also checks SQLite. The model is optional and is excluded from app readiness, so inference failure cannot disable progress or deterministic exercises. The tutor reports loading/unavailable status and allows a retry.

The first full-stack startup may wait for several GB of images and weights. If provisioning fails, `docker compose logs model-pull` explains the failure. Fix the network or disk issue and run `./start.sh` again. The app can already be running while provisioning finishes.

## Data migration and identity

A newly self-hosted instance has a new database. It cannot safely infer that an identity from a previous hosting gateway is the same person as a Google or Apple subject. Do not merge users by display name or email. Migrate an authenticated export only after the user proves ownership of both accounts.

Google and Apple are separate accounts in this release. Linking identities requires a dedicated authenticated linking flow and deliberate conflict handling; it is not approximated with matching emails.

## Known verification limits

Unit and integration tests use locally signed provider tokens and a mock token endpoint. They validate our code path, but do not prove that your OAuth consent screen, developer account, registered domain, return URL or credentials are configured correctly. Real-provider acceptance testing is a separate deployment step.

Docker and model execution must be verified on a Docker host. CI includes container boot and complete local-model smoke tests; review their results for the specific commit before treating that build as validated.
