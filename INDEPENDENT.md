# Matrix independent deployment

Matrix's canonical public address is [matrix-study.barri-nq.workers.dev](https://matrix-study.barri-nq.workers.dev). This version runs in the owner's Cloudflare account with a native D1 database and Matrix accounts. Visitors do not need ChatGPT, a ChatGPT subscription, or access to the earlier Sites project. Cloudflare hosting and each visitor's chosen AI provider remain separate services with their own usage terms.

The earlier Sites implementation remains in this repository for migration and compatibility. Use the `:independent` commands below for the independent website. The unqualified `build`, `dev`, and `start` commands still target the legacy Sites/Vinext build.

## Project layout

| File | Purpose |
| --- | --- |
| `independent/wrangler.json` | Worker identity, public origin, static assets, D1 binding, and migrations directory |
| `independent/worker.ts` | Standalone APIs, ownership checks, AI forwarding, sharing, and response headers |
| `independent/auth.ts` | Matrix sessions, email/password accounts, and optional Google sign-in |
| `independent/migrations/` | Native D1 workspace and account migrations |
| `vite.independent.config.ts` | Standalone React frontend build; no Sites authentication dependency |
| `scripts/independent-security-assets.mjs` | Generates `_headers` only inside the independent build output |
| `dist-independent/client/` | Generated production frontend assets; do not edit these files directly |

The Worker is named `matrix-study`. Its `DB` binding points to the configured `matrix-study` D1 database. `APP_URL` is `https://matrix-study.barri-nq.workers.dev`. If deploying a separate copy to another Cloudflare account, deliberately change the account/database identifiers and public origin in `independent/wrangler.json`; do not reuse another deployment's database.

## Build and publish

Use Node.js 24 for the tested toolchain. The package declares a minimum of Node 22.13. Run commands from the repository root.

```sh
npm ci
npm run build:independent
npm run db:independent
npm run deploy:independent
```

`build:independent` builds the frontend and adds its static security headers. `db:independent` applies pending native migrations to the **remote production database**. `deploy:independent` rebuilds the app, retains hashed JavaScript and CSS for the previous four builds so existing tabs can find their readers, and publishes the Worker and assets. Deployment does not implicitly run database migrations.

Equivalent explicit database command:

```sh
npx wrangler d1 migrations apply matrix-study --config independent/wrangler.json --remote
```

Migrations are tracked by D1. Preserve already-applied files; add a new numbered migration for later schema changes. The independent migrations replace the legacy `drizzle/` publishing path for this deployment.

## Runtime secrets

The Worker requires a cryptographically random `BETTER_AUTH_SECRET` of at least 32 characters. Google sign-in additionally needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep server credentials out of source, build assets, command arguments, and files.

Use Wrangler's protected prompts:

```sh
npx wrangler secret put BETTER_AUTH_SECRET --config independent/wrangler.json
npx wrangler secret put GOOGLE_CLIENT_ID --config independent/wrangler.json
npx wrangler secret put GOOGLE_CLIENT_SECRET --config independent/wrangler.json
```

For automated provisioning, send a JSON object containing those names directly from a secret manager to `npx wrangler secret bulk --config independent/wrangler.json` through standard input. Do not supply a filename, echo credentials into a terminal transcript, or write an intermediate JSON file. Changing the authentication secret can invalidate existing sessions and affect encrypted account tokens; preserve the configured value during routine deployments.

Each visitor connects their own AI provider in Matrix. API keys remain in that browser's session by default, with an explicit option to remember them on the device. They are sent transiently through the Worker to the selected provider and are excluded from the database, shared kits, and transfer files. No shared AI key or ChatGPT subscription powers this deployment.

## Google sign-in

Use the Google Cloud project `matrix-study` and a **Web application** OAuth client. Configure:

| Google client setting | Value |
| --- | --- |
| Authorized JavaScript origin | `https://matrix-study.barri-nq.workers.dev` |
| Authorized redirect URI | `https://matrix-study.barri-nq.workers.dev/api/auth/callback/google` |

The callback path is `/api/auth/callback/google`. Its origin must match `APP_URL`, and the full redirect URI must match Google's configuration exactly. [Google's server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) describes this matching requirement.

Google sign-in is available only when both Google runtime bindings are configured. Configure the consent-screen audience for the people who should be able to sign in; a project restricted to test users is not an unrestricted public sign-in service. Use separate development OAuth configuration if testing on localhost. Matrix does not automatically merge an existing email/password account with a Google account merely because their email text matches.

## Local development

Build the assets and apply migrations to a separate local D1 database:

```sh
npm run build:independent
npx wrangler d1 migrations apply matrix-study --config independent/wrangler.json --local
```

Local authentication requires a local development secret and a loopback `APP_URL`. For a memory-only setup, use a clean development shell and checkout without `.dev.vars` or `.env` files. This PowerShell example generates a temporary development secret without printing it or writing it to disk:

```powershell
$env:CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true'
$env:CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
$env:BETTER_AUTH_SECRET = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
npm run dev:independent -- --var APP_URL:http://127.0.0.1:8787
```

Open the loopback URL printed by Wrangler. Stop the server before closing that shell. Changing the temporary secret invalidates local sessions; production is unaffected. Wrangler's process-environment mode includes the shell's environment in local bindings, so use a clean shell rather than a session containing unrelated credentials. See [Cloudflare's local environment documentation](https://developers.cloudflare.com/workers/local-development/environment-variables/).

`dev:independent` serves the built frontend; rebuild after frontend edits. The local database and production D1 database are separate. Use the same local persistence directory for migrations and the server; the default commands above share the configuration's local state directory.

## Account capabilities

Email/password registration, sign-in, sign-out, and authenticated password changes are implemented. Passwords must be 12–128 characters. Sessions are stored in D1 and use secure HTTP-only cookies in production.

**Email verification and password-reset email delivery are not configured.** Do not present a reset-email or verification flow as available until a mail provider and the corresponding callbacks are implemented and tested. Users should retain their password or use an available Google account. Account email changes and automatic provider-account linking are disabled in the current implementation.

## Move from the earlier Matrix website

The Sites website and the independent website have separate accounts, databases, and browser storage. Signing in with the same-looking email does not transfer data automatically.

1. Open the earlier Matrix website in the browser/account containing your work.
2. Open **Settings → Your workspace → Move your whole workspace** and choose **Export workspace**.
3. Open [the independent Matrix website](https://matrix-study.barri-nq.workers.dev), then sign in or create the Matrix account you want to use.
4. Open the same account-settings section, choose **Import workspace**, select the exported JSON file, review its contents, and choose **Import into this workspace**.
5. Re-enter your AI API key under **AI connection** on the new website.

The transfer includes kits with flashcard progress and test history, notes, tasks, bookmarks, exam plans, and grade-calculator data. It supports up to 100 kits and a 12 MB transfer file; notes and planning data must fit the app's workspace limit. Exact duplicates are skipped and new entries get fresh IDs. Existing course plans and grade rows are preserved unless the user explicitly selects their replacement options. Public share links do not migrate; create new links on the new website when needed.

## Checks

Type-check and run the unit/API suites:

```sh
npx tsc --noEmit
node --experimental-strip-types --test scripts/study.test.mjs scripts/workspace.test.mjs scripts/practice.test.mjs scripts/transfer.test.mjs tests/ai.test.mjs tests/library.test.mjs tests/independent-auth.test.mjs
npm run build:independent
```

For standalone end-to-end API checks, start the local Worker with its local migrations and development secret, then run in a second PowerShell terminal:

```powershell
$env:MATRIX_TEST_URL = 'http://127.0.0.1:8787'
node scripts/independent.test.mjs
```

That integration test refuses production addresses. It creates disposable local accounts and verifies authentication, isolation between users, workspace and kit storage, sharing, and invalid requests. It does not contact an AI provider. A fresh local database avoids interference from previous test rate-limit records.

## Static security headers

The independent build writes `dist-independent/client/_headers`. Its CSP allows local scripts and connections, React's inline styles, local/blob PDF workers, and HTTPS images; it blocks framing and plugin objects. The file also supplies content-type, referrer, permissions, and HTTPS transport headers.

This file is intentionally absent from shared `public/`, so the older Sites host is unchanged. Cloudflare applies `_headers` to direct static-asset responses; Worker-generated API responses use the headers in `independent/worker.ts`. See [Cloudflare's static-asset header documentation](https://developers.cloudflare.com/workers/static-assets/headers/). After publication, verify the public HTML response has the expected CSP and test PDF extraction, sign-in, workspace transfer, and both desktop/mobile navigation.
