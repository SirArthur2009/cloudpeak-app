import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { existsSync } from 'node:fs'

const readEnv = path => existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
export const app = { ...readEnv(new URL('../.env', import.meta.url)), ...process.env }
app.VITE_SUPABASE_URL ||= process.env.SUPABASE_URL
app.VITE_SUPABASE_ANON_KEY ||= process.env.SUPABASE_ANON_KEY
export const database = { ...readEnv(new URL('./.env', import.meta.url)), ...process.env }
if (!database.DATABASE_URL) throw new Error('Set the server-only database-service/.env DATABASE_URL.')
export const publicTables = new Set(['dogs', 'litters', 'puppies', 'puppy_photos'])
export const tables = ['profiles', 'dogs', 'litters', 'puppies', 'puppy_photos', 'waitlist', 'applications', 'newsletter_signups', 'analytics_events', 'emails', 'admin_folders', 'admin_files', 'email_templates', 'guest_payments']
