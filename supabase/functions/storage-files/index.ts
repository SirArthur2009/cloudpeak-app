import { createLegacyStorageProxy } from './legacy-proxy.js'

// Supabase preserves old URLs; Railway verifies sessions and serves the files.
Deno.serve(createLegacyStorageProxy())
