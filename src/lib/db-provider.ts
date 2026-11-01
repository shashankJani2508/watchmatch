// Which database the API routes talk to.
//   DB_PROVIDER=neon      -> Neon
//   DB_PROVIDER=supabase  -> Supabase
//   unset                 -> Neon when it is configured, otherwise Supabase
// With neither configured the store falls back to in-memory (local dev only).
export function useSupabase(): boolean {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const neonReady = !!(process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL)

  const forced = process.env.DB_PROVIDER?.trim().toLowerCase()
  if (forced === 'supabase') return supabaseReady
  if (forced === 'neon') return false
  return supabaseReady && !neonReady
}
