# Cloudpeak local development

Open this folder in VS Code. Use `npm run dev` for the current Supabase-backed app, or `npm run dev:storage` for the app plus the local Railway signer. F5 launch configurations are available for both, plus storage security tests.

To run the app and public website together, open `../cloudpeak.code-workspace` in VS Code and choose **Cloudpeak: App + Website** with F5, or run `npm run dev:all` from this folder. The app runs at `http://127.0.0.1:5173` and the website at `http://127.0.0.1:5174`. Use **Cloudpeak: App + Website + Railway Storage** or `npm run dev:all:storage` to include the local signer. Stop the single launch to stop all its servers. Both sites still use their configured Supabase database.

See [storage testing and migration](storage-service/README.md) for the test page, local credentials, Supabase Edge Function setup, and verified migration steps. `npm run test:storage` runs security checks without changing remote data.

Use `npm run dev:railway` to run the app and website against the isolated Railway database and storage copy, keeping Supabase login. Email actions save local previews; real account/password mutations are blocked. See [Railway database and backend testing](database-service/README.md) for launch instructions, profile synchronization, server actions, and production limits.

Use `npm run prepare:railway` to generate a credential-free bundle for a hosted Railway test of both sites. See [hosted deployment instructions](deployment/README.md) for local bundle preview, server variables, test domains and the deployment sequence. This command prepares files locally and does not publish them.

## Puppy owner updates

Approve a family's puppy selection in Admin → Waitlist to reserve it, then mark the reserved puppy Sold in Admin → Puppies when the sale is complete. Sold puppies require an approved selection with a family email. The family signs into that email's account and opens My Puppy to submit photos or a new name. Admin → Owner updates reviews pending submissions, publishes individual photos, declines requests, and hides or republishes previously reviewed photos. Names only change on approval; photo approval adds a regular gallery entry used by both the portal and public website. Hiding removes that gallery entry; previously published image URLs may still be accessible.

For Supabase data/storage, apply `supabase/migrations/20261006021648_puppy_owner_updates.sql` before releasing the frontend. It creates the review table, permissions, review/status triggers, and private `owner-puppy-photos` bucket. For Railway data, `installBackend` installs `database-service/owner-updates.sql` at backend startup. Deploy the updated Railway storage signer alongside the app to enable verified owner uploads to the private prefix. Owner originals stay private; admin-approved copies go into `puppy-photos`. Supabase Auth remains the login provider in both configurations.

Run `npm run test:owner-updates` for transaction-rolled-back database checks using the configured Railway copy, and `npm run test:storage` for storage access checks without external mutations. The new migration and application code are prepared locally; running these checks does not release the feature.

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
# Better Auth migration

See [the migration guide](database-service/BETTER-AUTH-MIGRATION.md) for importing existing password hashes and configuring Better Auth. Run `npm run dev:railway` to start the complete local Railway data, auth, storage, and frontend stack. The frontend and server Auth provider settings must match.
