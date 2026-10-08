# Railway database test

This local test uses Railway Postgres for application records, Railway object storage for files, and your existing Supabase account for login. The copied database contains 14 application tables and 497 records from the migration snapshot. It does not automatically synchronize later changes from Supabase.

## Launch from VS Code

Open `cloudpeak-app` in VS Code. Select **Cloudpeak: Railway Database + Storage (Supabase Login)** in Run and Debug, then press F5. Alternatively run `npm run dev:railway` from the app directory.

- App: http://127.0.0.1:5173
- Website: http://127.0.0.1:5174
- Data API: http://127.0.0.1:3002/health

Stop another launch using the same ports before starting this one. The temporary verification preview uses app port 5177, website port 5178, and separate backend ports 3102, 3103, and 3105, so it can coexist with the VS Code launch. Keep the same hostname when signing in and testing storage. Restart `npm run dev:railway` after backend code changes.

Browser data and file-signing requests go through the app/website's own Vite origin (`/railway-api` and `/railway-storage`), which forwards to the loopback APIs. The browser does not need direct access to the backend ports. This also avoids the in-app browser blocking an alternate API port. Supabase Auth requests still go directly to Supabase.

Dependencies: run `npm install` in the app and `database-service` directories when needed. Run `powershell -ExecutionPolicy Bypass -File scripts/install-postgrest.ps1` from the app directory if the ignored PostgREST binaries are missing. Existing local database and storage credentials are in ignored `.env` files; never commit or put them into frontend variables.

## What to test

Sign in with your existing Supabase admin account. Browse puppies, litters, clients, applications, and admin files. The initial admin puppy view chooses the newest litter that has available puppies. Puppy cover photos use the last uploaded image, independent of gallery ordering. Assigned clients retain their assigned litter.

Create a clearly named temporary record, edit it, and remove it. These record changes affect the Railway test database. Upload a temporary file and delete it after testing. File operations use the Railway bucket copy, so deleting an existing file removes that Railway object; the original Supabase file remains intact.

The local API validates Supabase sessions and applies Railway database permissions. Anonymous visitors can read public dog/litter/puppy/photo records and submit public forms, but cannot read private application or client records. Database credentials stay on the server. Connections use the pinned database certificate chain.

## Current limits

Local email actions now create **previews** in the private Railway outbox instead of sending messages. In **Admin → Email**, click **Refresh email previews** and expand a message. Existing sent/inbound email history remains separate from these previews. Preview portal-credential messages omit passwords.

Local account creation, deletion, and password changes through the new server actions are blocked because they would affect the real Supabase accounts. Supabase login remains active. Local launch forcibly sets `EMAIL_MODE=preview` and `AUTH_WRITES_ENABLED=false`, even if the shell has other values configured.

Every verified Supabase user automatically receives a Railway client profile if missing. Existing Railway roles are preserved; user-editable metadata cannot promote a user. `node database-service/sync-auth.js` also synchronizes all existing Auth IDs using a server-only Auth admin key. It does not change Supabase users or copy passwords. Railway roles are authoritative for both data and the local storage signer. Changes made to old Supabase profile roles do not synchronize automatically.

The live app and website still use their existing configuration. No source Supabase business records or files were deleted, and these repository changes have not been committed or pushed. The hosted Railway test runs Linux PostgREST behind the HTTPS gateway; the VS Code test uses the Windows binary on loopback. Controlled real email and disposable account checks have passed both locally and on Railway, and the temporary account was deleted. Hosted staging restricts external actions to the approved test identities. The prepared live candidate and remaining coordinated release steps are in `../deployment/CUTOVER.md`.

## Server actions

The Node API implements client listing/creation/deletion, first-password changes, selection notifications, turn notifications, portal credential messages, replies, campaigns, application notifications, and the inbound email webhook. All application-data queries and email history writes use Railway. Only Auth admin operations use Supabase.

Server configuration lives in ignored `database-service/.env`; see `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` is server-only. The existing local legacy service key is accepted as a transitional fallback; it is never included in the Railway frontend launch. Live sending requires `EMAIL_MODE=live` and a Resend API key. Real account mutations additionally require `AUTH_WRITES_ENABLED=true`. Do not enable either for routine local tests.

Configure `PORTAL_URL` to the exact portal origin. Redirect links supplied by clients must use that origin. Application notifications use `APPLICATION_EMAILS` (comma-separated), defaulting to `cloudpeaksilverlabs@yahoo.com`, independently of admin login addresses. Reservation notifications use `ADMIN_EMAILS` or the Railway admin directory. Authored outbound emails have a subtle Cloud Peak header and footer; incoming forwards preserve their original content. Set `FORWARD_TO_EMAIL` to enable inbound forwarding and reply copies. Inbound webhooks require `RESEND_WEBHOOK_SECRET`, raw-body signature verification, and timestamps within five minutes; duplicate inbound emails are stored and forwarded once.

Ordinary live outbound messages use a durable private outbox and Resend idempotency keys. Admin-only `retry-email` retries a saved job within the provider's idempotency window. Credential emails are sent directly without storing passwords in the outbox or history. A failed credential send must be retried from client management. Automatic application notification repeats deduplicate; the existing resend action therefore does not send a second copy of an already delivered notification.

Deleting a client blocks their Railway access before deleting the Auth account. A provider failure leaves access blocked for review. Self-deletion and deletion of admins through client management are rejected. Profiles and other Railway cleanup occur after successful Auth deletion; cross-provider failures can require manual reconciliation before retrying.

## Verification

`node database-service/verify-api.js` checks Railway health, public relational reads, migrated photo links, rejected private access and forged sessions, blocked anonymous mutations, allowed origins, and authenticated server actions.

`node --test database-service/backend.test.js` exercises Railway profile sync, account permission checks, blocked local Auth writes, campaign and reply previews, application deduplication, email failure/idempotency handling, webhook signatures/retries, and client litter restrictions. Database writes are rolled back; Supabase Auth and Resend use injected doubles. No emails are sent and no real accounts are changed by these tests.

`node --test scripts/puppy-display.test.mjs` checks cover-photo selection and available-litter defaults.

The initial full database comparison and a rolled-back write passed before the copied file URLs were rewritten to Railway links. `verify.js` compares against that original snapshot, so it should not be rerun as an equality check after URL rewrites or intentional test edits.
