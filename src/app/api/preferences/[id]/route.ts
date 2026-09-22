import { NextRequest, NextResponse } from 'next/server'
import { Preferences, Partner, SessionRow, rowToSession } from '@/types'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'

// Pool generation runs inside the request: a serverless function is frozen
// once it responds, so fire-and-forget work never finishes in production.
export const maxDuration = 60

const useSupabase = () =>
  !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { partner, preferences }: { partner: Partner; preferences: Preferences } =
    await req.json()

  if (useSupabase()) {
    return handleSupabase(params.id, partner, preferences)
  }
  return handleStore(params.id, partner, preferences)
}

async function handleStore(id: string, partner: Partner, preferences: Preferences) {
  const { store } = await import('@/lib/store')
  const current = await store.getSession(id)
  if (!current) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const otherHasSubmitted =
    partner === 'a' ? !!current.partner_b_preferences : !!current.partner_a_preferences

  const patch: Record<string, unknown> = {
    [`partner_${partner}_preferences`]: preferences,
  }

  if (otherHasSubmitted && current.status !== 'generating' && current.status !== 'swiping') {
    patch.status = 'generating'
  } else if (!otherHasSubmitted && partner === 'a' && current.status === 'waiting_b') {
    patch.status = 'a_submitted'
  }

  const updated = await store.updateSession(id, patch as any)
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  if (updated.status === 'generating') {
    await generatePool(id, updated.partner_a_preferences!, updated.partner_b_preferences!, store)
    return NextResponse.json({ status: 'swiping' })
  }

  return NextResponse.json({ status: updated.status })
}

async function handleSupabase(id: string, partner: Partner, preferences: Preferences) {
  const { createServerClient } = await import('@/lib/supabase-server')
  const supabase = createServerClient()

  const { data: current, error: fetchError } = await supabase
    .from('sessions').select('*').eq('id', id).single()
  if (fetchError || !current) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const session = rowToSession(current as SessionRow)
  const otherHasSubmitted =
    partner === 'a' ? !!session.partnerBPreferences : !!session.partnerAPreferences

  const updatePayload: Record<string, unknown> = {
    [`partner_${partner}_preferences`]: preferences,
  }
  if (otherHasSubmitted && session.status !== 'generating' && session.status !== 'swiping') {
    updatePayload.status = 'generating'
  } else if (!otherHasSubmitted && partner === 'a' && session.status === 'waiting_b') {
    updatePayload.status = 'a_submitted'
  }

  const { data: updated, error: updateError } = await supabase
    .from('sessions').update(updatePayload).eq('id', id).select().single()
  if (updateError || !updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  const updatedSession = rowToSession(updated as SessionRow)
  if (updatedSession.status === 'generating') {
    await generatePool(id, updatedSession.partnerAPreferences!, updatedSession.partnerBPreferences!, supabase)
    return NextResponse.json({ status: 'swiping' })
  }
  return NextResponse.json({ status: updatedSession.status })
}

async function generatePool(
  sessionId: string,
  prefA: Preferences,
  prefB: Preferences,
  dbOrStore: any
) {
  const { buildPool } = await import('@/lib/pool')
  const { poolA, poolB } = await buildPool(prefA, prefB, [], 1)
  const allIds = Array.from(new Set([...poolA, ...poolB].map(t => t.tmdbId)))

  if (typeof dbOrStore.from === 'function') {
    await dbOrStore.from('sessions')
      .update({ status: 'swiping', pool_a: poolA, pool_b: poolB, seen_tmdb_ids: allIds })
      .eq('id', sessionId).eq('status', 'generating')
  } else {
    await dbOrStore.updateSession(sessionId, {
      status: 'swiping', pool_a: poolA, pool_b: poolB, seen_tmdb_ids: allIds,
    })
  }
}
