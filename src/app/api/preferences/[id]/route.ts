import { NextRequest, NextResponse } from 'next/server'
import { Preferences, Partner, SessionRow, rowToSession } from '@/types'
import { useSupabase } from '@/lib/db-provider'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'

// Pool generation runs inside the request: a serverless function is frozen
// once it responds, so fire-and-forget work never finishes in production.
export const maxDuration = 60


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
  const key = partner === 'a' ? 'partner_a_preferences' : 'partner_b_preferences'

  // Write only this partner's field, atomically. If both partners submit at the
  // same moment, a read-then-write would let one overwrite the other.
  const written = await store.mergeSession(id, { [key]: preferences })
  if (!written) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const bothDone = !!written.partner_a_preferences && !!written.partner_b_preferences

  if (!bothDone) {
    if (partner === 'a') {
      const moved = await store.transition(id, ['waiting_b'], { status: 'a_submitted' })
      return NextResponse.json({ status: (moved ?? written).status })
    }
    return NextResponse.json({ status: written.status })
  }

  // Both are in. The later of the two writes sees both sets of preferences, and
  // only one request can win this claim, so the deck is built exactly once.
  const claimed = await store.transition(id, ['waiting_b', 'a_submitted'], { status: 'generating' })
  if (!claimed) return NextResponse.json({ status: written.status })

  try {
    await generatePool(id, written.partner_a_preferences!, written.partner_b_preferences!, store)
  } catch (e) {
    // Don't leave the session stranded in 'generating'; let a retry claim it again.
    await store.transition(id, ['generating'], { status: 'a_submitted' })
    throw e
  }
  return NextResponse.json({ status: 'swiping' })
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
    await dbOrStore.transition(sessionId, ['generating'], {
      status: 'swiping', pool_a: poolA, pool_b: poolB, seen_tmdb_ids: allIds,
    })
  }
}
