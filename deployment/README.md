# Production Better Auth deployment — October 6, 2026

Deployment `c3bcbbef-0374-4f66-9b4f-4b964c5fd7d6` serves the live portal and website with Better Auth. Both domains passed health and build-ID verification (`2026-10-06T23:59:20.404Z`). Eight accounts retain their original UUIDs, passwords and Railway roles. Hosted checks passed for login, client permissions, admin denial, forced password changes, session revocation, logout and deletion. The temporary verification account and profile were removed; no test emails were sent. Auth rate limiting receives the real client address from Railway's edge through the gateway.

The release was uploaded directly from the local workspace. Source changes, including the matching GitHub Actions build configuration, are still uncommitted. Future source deployments must include these changes and set `AUTH_PROVIDER=better-auth`. Server credentials remain in Railway. See [the migration guide](../database-service/BETTER-AUTH-MIGRATION.md) for rollback considerations. The older deployment notes below describe the earlier Supabase Auth migration stages.

# Railway hosted test

For the live production backup audit and recovery steps, see [BACKUP-RESTORE.md](BACKUP-RESTORE.md). The authenticated Railway page confirms no Postgres backups and a Pro-plan requirement for native backups/PITR. Independent backups and a restore drill remain unverified.

One Linux container serves the app and website on two different HTTPS hostnames. Its gateway exposes only port 8080. Data API, PostgREST and storage signer bind to loopback. Postgres and the bucket remain private; public puppy images redirect to short-lived S3 links. Supabase handles login. Startup defaults to preview emails and blocked Auth writes. The current deployed build is restricted staging: only the approved test email recipient and disposable account may receive external actions. See `CUTOVER.md` for the verified live candidate and coordinated release sequence; the live domains still point to Netlify.

Hosted verification passed: the approved email was sent through the admin UI and reported delivered, and the disposable account passed real Auth checks plus client access/password changes through public HTTPS. Cleanup was verified. Latest live record changes were copied on October 5 without removing Railway-only test data. The prepared live build removes the test banner; it has not been deployed.

## Deployed hosted test — October 2, 2026

The approved bundle was uploaded with Railway CLI; no GitHub push or production domain switch was performed. Its Linux image built successfully, including checksum verification of PostgREST, and Railway's health check passed. Credentials are stored as service variables. PostgreSQL connects at `postgres.railway.internal:5432` with the pinned CA. Existing bucket CORS rules were preserved while both test origins were added and verified.

- App: https://cloudpeak-hosted-test-production.up.railway.app
- Website: https://cloudpeak-hosted-test-production-0e41.up.railway.app
- Identifiers and safety settings: `deployment/hosted-test.json` (no credentials).

Verified the hosted admin session, 11 public gallery images served through Railway, signed-out/forged-session denial, and an actual hosted email preview without sending. A disposable text file and PNG uploaded through the hosted app matched their source SHA-256 hashes; the private image preview loaded correctly. Both disposable objects and their two Railway test records were removed. The synthetic hosted email preview remains available for review. The file-preview variable shadowing error discovered during verification was fixed and redeployed.

The app currently uses email/password sign-in without OAuth or password-reset redirect flows, so no Supabase Site URL change is required. Preserve the existing live Auth URL settings. If those redirect-based features are added later, explicitly add their exact test callback URLs then.

## Prepare from VS Code

From `cloudpeak-app`, run `npm run prepare:railway`. It builds the app with relative same-origin API URLs, copies website assets and a fixed list of backend files, and writes a new folder under `deployment/bundle`. It excludes `.env`, source database snapshots, Windows executables, local reports, Git metadata and service keys. Read `deployment/bundle/latest.json` for the exact deploy folder. The bundle includes the current database's public CA certificate, not database credentials.

Docker is not installed on this computer. The Linux image build and runtime were verified on Railway on October 2, 2026. The PostgREST Linux executable is pinned to 16.4 with the official release SHA-256 checksum. Dockerfile targets Railway's x86-64 runtime.

To inspect the built frontend bundle locally, keep `npm run dev:railway` running, then run `npm run preview:deployment` in a second terminal. Open the app at `http://127.0.0.1:5179` and website at `http://127.0.0.1:5180`. This preview reuses the local Railway backend and requires preview email mode with blocked account writes. Run `npm run test:deployment` for gateway routing, safe file handling and proxy checks. Stop the extra preview with Ctrl+C.

## Hosted deployment sequence (approved and completed for this test)

1. Create an empty `cloudpeak-hosted-test` service in the existing Cloudpeak Railway project, using the existing isolated database copy. Do not attach the live Supabase database or change production domains.
2. Upload the generated bundle as the deployment root using Railway CLI, or build it with Docker. The bundle contains `Dockerfile` and `railway.json`; configure the health check as `/health` and the target port as 8080. No GitHub push is needed for CLI deployment.
3. Create two HTTPS domains on this service: one for the app and one for the website. These are test domains, separate from the current live domains. Set `APP_ORIGIN` and `WEBSITE_ORIGIN` to those exact origins without trailing slashes. The service denies other hosts except the health-check endpoint.
4. Set server-only variables listed in `deployment/.env.example`. `DATABASE_URL` uses the existing Railway Postgres administrator login. `API_DATABASE_URL` uses the existing restricted `cloudpeak_authenticator` login. Keep the connection encrypted and retain the pinned database CA. Prefer private database networking with the same credentials; never put either URL or a service-role key in browser settings. The optional Supabase service-role key permits admin account listing, but Auth writes stay blocked.
5. Add both test origins to the bucket CORS rules for GET/HEAD/PUT, preserving the current localhost and live origins. Include headers `content-type`, `if-none-match`, `range` and `x-amz-*`. Browser uploads need this even though the storage handler shares the site's origin.
6. Ordinary email/password sign-in continues to use the existing Supabase project and does not require redirect settings. If password recovery or OAuth redirect flows are added, add their exact app test callback URLs in Supabase Auth URL Configuration. Preserve the current production Site URL and existing allowed redirects. No new accounts are required for the admin test.
7. Deploy and wait for `/health` to report success. Verify both domains, `/admin` refresh, admin login, available litter selection, last-uploaded hero photos, private-file denial when signed out, and a small disposable upload/download/delete test. Confirm email previews are stored without sending.
8. Leave the current live app and website running. Review the hosted test before configuring live emails, enabling Auth mutations, refreshing production data or switching domains. The isolated copy is not automatically kept in sync with live Supabase records.

## Expected test behavior

Both browser clients use `/railway-api` for records/actions and `/railway-storage` for file requests. Gateway responses rewrite copied Supabase Edge photo URLs to Railway addresses without editing stored records. New uploads already use the Railway address. Existing hardcoded/static marketing assets may reference external hosts; this does not mean database records are being fetched from Supabase.

The test copy contains real records, so anyone with an existing authenticated role sees the records allowed by its Railway policies. Public test websites expose the same public puppy/dog/litter data as the current website. Supabase sessions remain in that provider. Database and storage writes from this hosted test go to the same Railway test database and bucket used by the local test; the bucket also serves copied production photos, so use disposable objects and avoid modifying existing files during testing.
# Automatic production deployment

The repositories stay separate. A push to `main` in either `cloudpeak-app` or `cloudpeak-web` runs the app's reusable GitHub Actions workflow, checks out both current `main` branches, builds a secret-free combined bundle and deploys the existing Railway service. Both custom domains must pass health and exact-revision checks before the workflow succeeds. If either branch changes during a build, that outdated build stops and the newer push handles deployment.

Each repository uses the encrypted `RAILWAY_TOKEN` Actions secret, scoped to the Cloudpeak production environment. Public `SUPABASE_URL` and `SUPABASE_ANON_KEY` Actions variables supply the frontend build. Private database, storage, Supabase admin and Resend credentials stay in Railway, never GitHub source or frontend build settings. Do not connect the Railway service directly to one repo as well, which would create a second deployment path.

Edit and push the repository that owns the change. Track progress in its Actions tab. No VS Code process is needed to keep the hosted app running.

Railway stores account IDs/roles in `public.profiles` and email/name/phone in private `cloudpeak_internal.user_directory`. Admin user listing reads Railway. Verified Supabase users synchronize contact details at login and account creation/update; `node database-service/sync-auth.js` backfills existing users without changing Supabase accounts. Passwords and authentication sessions remain exclusively in Supabase Auth.
