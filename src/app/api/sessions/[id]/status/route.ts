import { NextRequest, NextResponse } from 'next/server'
import { useSupabase } from '@/lib/db-provider'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Polling only needs to know whether anything changed. The full session row
// carries both decks, which is far too much to re-download every few seconds.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (useSupabase()) {
    const { createServerClient } = await import('@/lib/supabase-server')
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('sessions')
      .select('status,round,matched_tmdb_id,matched_type')
      .eq('id', params.id)
      .single()
    if (error || !data) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json({
      status: data.status,
      round: data.round,
      matchedTmdbId: data.matched_tmdb_id,
      matchedType: data.matched_type,
    }, { headers: NO_STORE })
  }

  const { store } = await import('@/lib/store')
  const st = await store.getSessionStatus(params.id)
  if (!st) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json({
    status: st.status,
    round: st.round,
    matchedTmdbId: st.matched_tmdb_id,
    matchedType: st.matched_type,
  }, { headers: NO_STORE })
}
