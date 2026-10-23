# Full Stack Learning Lab

A guided learning app with 28 short lessons in JavaScript, React, Express, and Sequelize, followed by an optional 60-minute practice simulation. Original practice material only. Close the app before a proctored assessment.

## Features

- Four-step lessons: Learn, Notice, Try, Remember.
- Editable code, isolated behavioral tests, progressive hints, and a slow-down prompt.
- XP, daily goals, spaced review, and resumable drafts.
- Hosted account sign-in with no separate app password.
- Per-user database records for learning and optional practice sessions.
- Save indicators, retry on connection failure, and optimistic concurrency to prevent silent overwrites.
- Explicit opt-in import of progress from the browser-only version.

## Development

Requires Node 24 or later. Run `npm ci`, `npm run build`, and `npm test`.

`src/` contains the React client and exercises. `worker/index.js` handles authenticated APIs and serves bundled assets. `db/schema.ts` defines the database schema, and `drizzle/` holds immutable migrations. Run `npm run db:generate` after changing the schema. Migrations must be applied before starting the Worker.

## Hosting contract

The Worker expects a D1 binding named `DB`. The hosting gateway authenticates visitors and supplies the trusted user identity. Never expose the Worker directly behind a gateway that accepts client-supplied identity headers. Browser sign-in and sign-out use the hosting platform's routes; this app does not handle passwords or session tokens.

The deployment manifest declares logical storage bindings only. Configure your own hosted project identity before deployment. A generic static host cannot run the authenticated APIs.

## Data protection

Every progress read and write is scoped to the server-provided user ID. Write requests require the exact same-origin `Origin` header, JSON content, valid payload shape, a size limit, and the current revision. Responses containing account information are not cached. Learner code executes in a separate Worker with network access disabled by response policy.

No credentials, user progress, database files, environment values, build output, or development runtime state belong in version control.

## Verification

`npm test` checks anonymous access rejection, user isolation, reload persistence, concurrent writes, request origin and payload validation, sign-in UI, legacy import, save retry, and lesson behavior.
