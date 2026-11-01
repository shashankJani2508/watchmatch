import { NextResponse } from 'next/server'
import { useSupabase } from '@/lib/db-provider'

export const dynamic = 'force-dynamic'

// Neon suspends an idle database and the first query afterwards takes a few
// seconds to wake it. The home page calls this in the background so the wake-up
// happens before the user taps "Start a session".
export async function GET() {
  try {
    if (!useSupabase()) {
      const { store } = await import('@/lib/store')
      await store.ping()
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
