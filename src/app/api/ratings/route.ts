import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { sessionId, tmdbId, titleType, score } = await req.json()
  const supabase = createServerClient()

  const { error } = await supabase.from('ratings').insert({
    session_id: sessionId,
    tmdb_id: tmdbId,
    title_type: titleType,
    score,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
