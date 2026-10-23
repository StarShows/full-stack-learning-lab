# Google and Apple sign-in setup

Credentials belong only in `.env` or files mounted under `/run/secrets`. They must never be committed, included in a container image, or placed in browser code. The app never asks for a Google or Apple password.

## Google

1. In Google Cloud Console, create or select a project. Configure its OAuth consent screen and audience. Add test users if the app is in testing.
2. Create an OAuth client with the **Web application** type.
3. Register the exact redirect URI:
   - Local development: `http://localhost:13000/auth/google/callback`
   - Deployment: `https://YOUR-DOMAIN/auth/google/callback`
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
5. Set `APP_URL` to the matching origin, without a path. Run `./start.sh` again.

The server exchanges the authorization code using PKCE, verifies the signed identity token, and creates a local session. It does not request offline access or retain provider access/refresh tokens.

## Apple

Apple web sign-in requires an Apple Developer account, an App ID with Sign in with Apple enabled, and an associated Services ID. Apple requires an HTTPS return URL with a domain name; an IP address or localhost cannot be used.

1. Enable Sign in with Apple on the primary App ID in Certificates, Identifiers & Profiles.
2. Create/configure a Services ID for the web app. Associate it with the primary App ID and configure your domain and return URL: `https://YOUR-DOMAIN/auth/apple/callback`.
3. Create a Sign in with Apple key. Keep the downloaded `.p8` file private and record its Key ID and your Team ID.
4. Set these `.env` values:
   - `APP_URL=https://YOUR-DOMAIN`
   - `APPLE_CLIENT_ID`: the Services ID.
   - `APPLE_TEAM_ID`: the developer Team ID.
   - `APPLE_KEY_ID`: the key's ID.
   - `APPLE_PRIVATE_KEY`: the PKCS#8 private key as a quoted value with literal `\n` escapes, or `APPLE_PRIVATE_KEY_FILE=/run/secrets/apple.p8` instead.
5. If using a file, put it under `secrets/`. The runtime's UID 1000 must be able to read it. Prefer a read-only, group-readable secret mount owned by the deployment administrator. Never make the key publicly accessible or mount your entire home directory.
6. Put a trusted HTTPS reverse proxy in front of the app, preserving `Host`. Run `./start.sh` again.

The server creates a five-minute ES256 client-secret assertion when exchanging a code. Apple's form-post callback is supported. Its temporary flow cookie uses `SameSite=None; Secure` so the browser can include it on the cross-site POST. The resulting application session uses `SameSite=Lax; Secure; HttpOnly` and expires after seven days. The app verifies the nonce and identity-token signature before using the subject or email.

The Apple-provided email may be a private relay address. Do not assume it matches a Google identity. Display name falls back to the verified email or provider label; no account merging takes place.

## Deployment acceptance checklist

- Verify each configured provider can sign in and resume that user's saved lesson after a server restart.
- Verify sign-out invalidates the old session, and a second user starts with separate progress.
- Confirm Google redirect URIs and Apple return URLs match `APP_URL` exactly.
- Confirm credentials stay server-side and HTTPS cookie flags are present.
- Keep `.env`, `secrets/`, data volumes, and database backups out of Git and web-served directories.

## Provider references

- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- Apple web configuration: https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple
- Apple token validation: https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens
