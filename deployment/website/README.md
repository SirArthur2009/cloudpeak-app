# Independent website service

The website runs in its own Railway container. It starts only the static gateway,
with no database or storage child processes. Its `/health` checks its local
homepage rather than backend availability. A backend crash or redeployment
therefore cannot stop website pages, navigation, CSS, scripts, or bundled images.

Same-origin `/railway-api` and `/railway-storage` requests proxy to the existing
portal gateway with an eight-second timeout. Live puppy/litter data, uploaded
photos, applications, newsletter signup, analytics, and dynamic sitemap generation
still depend on the backend. Existing page error states handle failed requests;
form errors do not claim a submission succeeded. There is no stale-data cache.

## Build and test

From `cloudpeak-app`, run `npm run test:deployment` and `npm run prepare:website`.
The new folder recorded in `deployment/bundle/website-latest.json` is the upload
root. It contains website assets and the Node gateway, without an npm install,
backend code, app frontend, or private configuration.

## Activation

1. Create a separate `cloudpeak-website` Railway service in project
   `ba2498be-e030-473a-81b4-a14d05dd8120`, production environment
   `bd380cbe-c04c-4174-a8b7-5e126c99dc06`. This adds a separately billed service.
2. Set only `APP_ORIGIN=https://portal.cloudpeaksilverlabradors.com`,
   `WEBSITE_ORIGIN=https://cloudpeaksilverlabradors.com`,
   `BACKEND_ORIGIN=https://portal.cloudpeaksilverlabradors.com`, and `PORT=8080`.
   Add its generated HTTPS URL to `WEBSITE_ALIASES` for preview verification.
   Upload the website bundle with `--path-as-root --no-gitignore`.
3. Verify `/health`, pages, CSS, public API reads, photos, and error behavior on
   the preview domain. Website health must remain independent of the backend.
   Do not crash production to test this; the automated isolation test covers it.
4. After approval, move only `cloudpeaksilverlabradors.com` to the website service
   and update its DNS route as Railway requires. Leave the portal and backend
   service in place. Verify HTTPS and public website behavior after the move.
5. Push the app repository's new reusable workflow before the website workflow
   that references it. Set the GitHub Actions variable `WEBSITE_RAILWAY_SERVICE_ID`
   to the new service ID in **both repositories**. Both repositories' existing
   `RAILWAY_TOKEN` secrets must authorize the production project and new service.
   Website pushes then use `railway-website.yml`; app pushes verify only the portal.
   `WEBSITE_VERIFY_ORIGIN` is optional and defaults to the production website.
6. For gateway changes, manually run `railway-website.yml` in the app repository
   as well as deploying the app. Website releases record `websiteSha` and
   `runtimeSha`, allowing the two frontends to release independently.

Until the variables are set, the existing combined deployment stays active.
The backend bundle retains a copy of website assets for rollback but cannot serve
the website's production traffic after its domain moves to the separate service.

## Rollback

Move the website domain and its DNS route back to the original service
`11612220-77f2-4c35-85c9-dd99d1b0cb1b`, unset `WEBSITE_RAILWAY_SERVICE_ID` in both
repositories, and run the combined deployment workflow. Keep the website service
until rollback is verified. Account for cached DNS and certificate readiness
during either domain move.
