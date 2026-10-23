# Learning rhythm and reminders

Learning rhythm is available after sign-in. Sound, opening-hour suggestions, and push reminders default to off. Motion follows the operating system reduced-motion preference and the account’s Calm motion setting. Tips follow lesson stages. All preferences use the same authenticated, revision-checked account storage as progress.

## Delivery

The self-hosted HTTPS server runs a minute scheduler automatically; no subscription service or API key is needed. The app must be running, reachable, and able to connect over HTTPS to Apple, Google FCM, or Mozilla push services. iOS/iPadOS 16.4+ requires installation to the Home Screen and a user-initiated permission request. Desktop support varies. Installing alone does not enable notifications. Local HTTP development reports delivery unavailable.

Each account chooses a daytime time and time zone. The scheduler sends at most three reminders in a rolling seven-day window, at least 36 hours apart, one per local date. It skips opening dates and snoozed accounts. It only attempts delivery during the ten-minute window after the preferred time, uses a 60-second TTL, and never catches up after downtime. Device Focus, OS delivery policies and network availability can suppress or delay delivery; this is not an alarm service. All notification content is generic and silent. The in-app sound setting controls only in-app sounds.

The most recently connected device is tried first; expired endpoints are removed. One successful or transiently failed endpoint ends the attempt, preventing multiple-device alerts. Persistent claims prevent duplicates across restarts and concurrent processes. Failed attempts count toward frequency limits; there is deliberately no retry queue. A crash after a claim may skip a reminder. Disable affects future dispatches; an already accepted push may still arrive within its short lifetime.

## Data and security

The SQLite data volume stores subscriptions, a generated VAPID private key, delivery claims, and account preferences. Keep backups encrypted and access restricted. Never commit the volume. The key is generated automatically once and survives container restarts. Losing or rotating it requires devices to disconnect and re-enable notifications. Endpoint URLs are capability secrets; logs omit them and notification contents.

Subscription routes require an authenticated session, same-origin JSON writes, a bounded payload, and allowlisted HTTPS push endpoints. Redirects are rejected. One endpoint belongs to one account; reconnecting transfers the device to the signed-in account. Limit: five devices per account. Sign-out disconnects that browser. Users can disconnect individually, turn off all reminders, pause seven days, or forget their opening history.

Only a date is recorded when hour suggestions are off (hour field is zero). Opting into suggestions resets the history and records the first opening hour per local day. After five distinct days the app suggests the most common hour, clamped to 09:00–20:00; it never enables reminders or changes schedules automatically. The last 35 opening days are retained, and delivery claims expire after 35 days. No third-party analytics or browsing tracking is added. Account sync must finish for a new opening or preference to affect scheduling.

The service worker does not intercept or cache network requests. It always shows a notification for an incoming push and opens/focuses only this app. Empty push bodies carry no account or lesson data; the worker supplies fixed encouragement.

## Verification

`npm run build && npm test` covers account isolation, settings UI, subscription authorization, endpoint rejection, time zones including DST, visit-day suppression, caps, signatures, expired devices, durable deduplication, and existing lessons/authentication. A physical-device acceptance test is still required: deploy with HTTPS, install on iPhone, sign in, connect notifications, choose a future daytime time, and test on a later unvisited day. Confirm Focus behavior, disconnect, and seven-day pause. Do not bypass the user safeguards in production to test delivery.

## Hosted edition

The ChatGPT-hosted edition includes motion, tips, sounds, install metadata, saved time preferences and pattern suggestions. A supported unattended background dispatcher has not been configured there. It explicitly reports background delivery unavailable and does not request notification permission. The self-hosted server includes the dispatcher described above.
