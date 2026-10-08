import { createAuthClient } from 'better-auth/client'

const key = 'cloudpeak_better_auth_token'
const listeners = new Set()
const base = new URL(import.meta.env.VITE_BETTER_AUTH_URL || `${import.meta.env.VITE_DATA_API_URL || '/railway-api'}/api/auth`, window.location.origin).href
export const authClient = createAuthClient({
  baseURL: base,
  fetchOptions: {
    timeout: 15000,
    auth: { type: 'Bearer', token: () => localStorage.getItem(key) || '' },
    onSuccess: ({ response }) => {
      const token = response.headers.get('set-auth-token')
      if (token) localStorage.setItem(key, token)
    },
  },
})
function session(data) {
  return data?.user && data?.session ? {
    access_token: localStorage.getItem(key),
    user: { ...data.user, user_metadata: { name: data.user.name, phone: data.user.phone }, app_metadata: { must_change_password: data.user.mustChangePassword } },
  } : null
}
const notify = next => listeners.forEach(listener => listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next))
export const betterAuthCompat = {
  async getSession() {
    const result = await authClient.getSession({ fetchOptions: { cache: 'no-store' } })
    if (result.error) return { data: { session: null }, error: result.error }
    const next = session(result.data)
    if (!next) localStorage.removeItem(key)
    return { data: { session: next }, error: null }
  },
  async getUser() {
    const result = await this.getSession()
    return { data: { user: result.data.session?.user || null }, error: result.error }
  },
  async signInWithPassword({ email, password }) {
    const result = await authClient.signIn.email({ email, password })
    if (result.error) return { data: { session: null }, error: result.error }
    const current = await this.getSession()
    notify(current.data.session)
    return current
  },
  async signOut() {
    const result = await authClient.signOut()
    if (result.error) return { error: result.error }
    localStorage.removeItem(key)
    notify(null)
    return { error: null }
  },
  onAuthStateChange(callback) {
    listeners.add(callback)
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
  },
}
window.addEventListener('storage', event => {
  if (event.key === key) betterAuthCompat.getSession().then(result => notify(result.data.session))
})
