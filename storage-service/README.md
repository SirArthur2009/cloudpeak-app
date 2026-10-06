# Cloudpeak storage: local testing and migration

The production design uses a **Supabase Edge Function** to sign direct browser requests to Railway's private bucket. No public Railway service or domain is needed. Supabase continues to provide login and database access. Only URL signatures, authorization checks and redirects pass through the function; uploaded and downloaded file bytes travel directly between the browser and Railway.

The live Railway server uses `supabase/functions/storage-files/handler.js`. It validates Supabase sessions and reads roles from Railway. The Supabase `storage-files` function now runs `legacy-proxy.js`, forwarding saved compatibility URLs to the live Railway gateway. It no longer queries Supabase business tables. Public photo and pedigree links receive temporary signed redirects. User-editable metadata never determines access.

The original migration and standalone signer instructions below describe the setup before the hosted Railway cutover. The compatibility function entrypoint now requires no S3 credentials; the Railway server owns those credentials and performs file authorization.

## Launch from VS Code

Open the **cloudpeak-app** folder in VS Code. Node 22.9 or newer is required. The local Node runner does not require Docker, Deno, or a deployed Edge Function.

```sh
npm install
npm ci --prefix storage-service
npm run storage:setup
npm run dev:storage
```

Alternatively press F5 and choose **Cloudpeak: Railway Storage (App + Local Signer)**. The existing **Debug Vite App (Start Server + Chrome)** launch remains available for the current Supabase-backed app.

The app is at `http://127.0.0.1:5173` and the signer listens only on the local loopback interface at port 3001. Both processes stop together when you stop the launch or press Ctrl+C. Railway credentials are in the ignored `storage-service/.env`, never in frontend `VITE_*` variables. `storage:setup` preserves existing settings. The runner overrides the storage URL only in its child process; it does not switch production or edit the app's normal `.env`.

The existing database and login still use the Supabase project in the app's `.env`. Ordinary admin actions in the app can therefore edit that project's data. **Use the storage test page first**: it does not create or update database records. For isolated testing of the full admin app, use a separate Supabase development project and test Railway bucket, updating the local environment files accordingly.

## Test files without changing database records

To test the **deployed** Supabase signer and Railway bucket, stop the current local app server, then run `npm run dev:storage:deployed` or choose **Cloudpeak: Test Deployed Railway Storage** in VS Code. This launches the local app against the deployed signer without starting a local storage server. Existing database photo URLs still point to Supabase until the later live cutover; viewing the same records alone does not test Railway.

1. Open `http://127.0.0.1:5173/storage-test.html` and sign in using the form on that page. It displays your account and database role.
2. If already signed in to the app, use the same browser profile and exact origin. Chrome, the in-app browser, localhost, and 127.0.0.1 do not share all sessions.
3. Choose a small test file and click **Upload and verify**. It checks unauthenticated access is rejected, confirms the private prefix has no public route, then uploads/downloads a private object and compares SHA-256 hashes.
4. Click **Delete test file** to remove that object. If you close the page before cleanup, remove the generated object from `admin-files/storage-tests/` in Railway's file explorer.

Do not close the test tab during an upload. Existing private files become available in Railway mode after their verified copy completes. `npm run dev` continues to use the current Supabase storage normally.

Run security tests with `npm run test:storage`, or use the VS Code **Cloudpeak: Storage Security Tests** launch. A real bucket verification is also available:

```sh
# With dev:storage running, from storage-service:
node --env-file=.env verify-local.mjs
```

That command creates a generated public test object, verifies direct download and the local redirect hash, checks unauthenticated private access is denied, and deletes only its own object. It does not migrate production data.

## Current external setup

[Railway Cloudpeak project](https://railway.com/project/ba2498be-e030-473a-81b4-a14d05dd8120):

- Private bucket: `cloudpeak-files-zbh-0l959`, endpoint `https://t3.storageapi.dev`, region `auto`.
- Bucket credential references also exist on the unused private `cloudpeak-storage` Railway service. The Edge Function design does not need that service deployed.
- Bucket CORS allows the Cloudpeak website (with and without `www`), `http://localhost:5173`, and `http://127.0.0.1:5173`.
- `storage-files` is deployed with scoped `CLOUDPEAK_STORAGE_*` secrets. A real upload/download hash check and anonymous private-access checks passed in the deployed runtime.
- All 415 existing files (4,239,386,631 bytes) were copied and read back with matching SHA-256 hashes on October 1, 2026. A fresh source inventory and destination check confirmed the same 415 files. The deployed `/health` endpoint returns 200.
- The ignored `migration-manifest.json` records verified hashes and the completed copy timestamp. Rerun the copy before any later live switch to include files added or changed since this snapshot.
- Code changes remain local. Live frontend settings and database URLs have not been switched. Original Supabase files remain intact.

## Production setup, after local testing

Put the Railway credentials and exact production `ALLOWED_ORIGINS` in the Supabase project's Edge Function secrets. Use `supabase/functions/storage-files/.env.example` as a reference. The function needs only a Supabase anon/publishable key; **do not give it a service-role key**. Never commit credentials. For CLI local serving, `CLOUDPEAK_SUPABASE_URL` and `CLOUDPEAK_SUPABASE_ANON_KEY` select the same Supabase project used by the frontend rather than the CLI's automatic local project.

The function config has `verify_jwt = false` so anonymous visitors can load the already-public photo/pedigree prefixes. Every POST independently validates the user with `auth.getUser(token)` and checks the database role. The private prefix is denied on public routes.

Deploy only `storage-files` when production deployment is authorized. Its base URL will be:

```text
https://bvnurkvvhlmdapvhvcje.supabase.co/functions/v1/storage-files
```

Set the bucket's CORS origins to both the production website/portal and any local origins you still need. From `storage-service`, `node --env-file=.env configure-cors.js` replaces this bucket's CORS policy with the exact `ALLOWED_ORIGINS` list. File requests are made directly to the bucket, so this is required for browser PUT and fetch requests.

The shared handler is tested in Node, including the complete Supabase function URL prefix. The Deno entry point has also passed a deployed public-redirect hash test and anonymous private-access checks. `/health` deliberately requires `_migration/ready.json`, which is created only by a completed verified copy. Run `node scripts/verify-storage-deployment.mjs` from the app folder to check copied public files and readiness.

## Copy and switch

Use an ignored local server `.env` with a Supabase service-role key **only on the migration machine**, to read private source objects and update records. Set `STORAGE_PUBLIC_URL` to the deployed function base URL above. Pause file edits during the final copy and switch.

```sh
# From storage-service:
npm run migrate -- --plan
npm run migrate -- --copy
```

All four prefixes are copied: admin files, puppy photos, dog photos, and pedigree files. Every destination object is downloaded and checked against its SHA-256 hash. An ignored manifest supports resuming; a readiness marker is written only after every copy passes. Rerun `--copy` if source files changed. `STORAGE_COPY_CONCURRENCY` can be set to 1–8 (default 4) to control concurrent transfers.

Then set the deployed app's `VITE_STORAGE_API_URL` to the function base URL and deploy the app. Public website pages already read photo URLs from the database. Run:

```sh
npm run migrate -- --rewrite
```

The rewrite checks every source object's verified copy, service health, and destination public links. It backs up original URLs locally before conditionally updating dogs, puppies and puppy photo records. Admin metadata paths stay unchanged. Stable redirect URLs are stored; temporary S3 signatures are never stored in database fields.

Check production galleries, dog photos, pedigree PDFs, private previews/downloads, upload/delete workflows and ordinary client access. Railway currently returns full-resolution originals; the adapter ignores Supabase thumbnail transform options.

## Does this fix the usage problem?

After switch-over, Railway serves the file bytes, reducing Supabase storage-related cached and uncached egress. Original objects must then be removed from Supabase to reduce its storage usage, after verification and a separate backup. That deletion is not performed by these scripts. The copy itself consumes Supabase download traffic. Existing billing-period egress totals do not disappear when links change.

Supabase database/API traffic and the function's small signing responses remain. A file migration will not fix unrelated database egress, logging quotas, or an application repeatedly querying the database. Function invocation quotas and Railway storage billing also still apply.

## Rollback

Source objects are retained. Restore original values from ignored `url-backup.json` using conditional updates matching the recorded `next` values, clear `VITE_STORAGE_API_URL`, and redeploy. Copy any new Railway uploads back before rolling back their metadata. Do not delete the original source objects until the switch is fully verified.

Docs: [Railway uploading/serving](https://docs.railway.com/storage-buckets/uploading-serving), [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration).
