# Cloudpeak local development

Open this folder in VS Code. Use `npm run dev` for the current Supabase-backed app, or `npm run dev:storage` for the app plus the local Railway signer. F5 launch configurations are available for both, plus storage security tests.

To run the app and public website together, open `../cloudpeak.code-workspace` in VS Code and choose **Cloudpeak: App + Website** with F5, or run `npm run dev:all` from this folder. The app runs at `http://127.0.0.1:5173` and the website at `http://127.0.0.1:5174`. Use **Cloudpeak: App + Website + Railway Storage** or `npm run dev:all:storage` to include the local signer. Stop the single launch to stop all its servers. Both sites still use their configured Supabase database.

See [storage testing and migration](storage-service/README.md) for the test page, local credentials, Supabase Edge Function setup, and verified migration steps. `npm run test:storage` runs security checks without changing remote data.

Use `npm run dev:railway` to run the app and website against the isolated Railway database and storage copy, keeping Supabase login. Email actions save local previews; real account/password mutations are blocked. See [Railway database and backend testing](database-service/README.md) for launch instructions, profile synchronization, server actions, and production limits.

Use `npm run prepare:railway` to generate a credential-free bundle for a hosted Railway test of both sites. See [hosted deployment instructions](deployment/README.md) for local bundle preview, server variables, test domains and the deployment sequence. This command prepares files locally and does not publish them.

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
