import { NextRequest, NextResponse } from 'next/server'
import { Partner, SessionRow, rowToSession, DECK_SIZE, MIN_ROUND_DECK } from '@/types'
import { useSupabase } from '@/lib/db-provider'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'

// Round 2 builds its pool inside this request.
export const maxDuration = 60


interface SwipeBody {
  sessionId: string
  partner: Partner
  tmdbId: number
  titleType: 'movie' | 'tv'
  liked: boolean
  round: number
  isFinal?: boolean
  deckFinished?: boolean
  deckSize?: number
  poolLength?: number
}

export async function POST(req: NextRequest) {
  const body: SwipeBody = await req.json()
  const { sessionId, partner, tmdbId, titleType, liked, round, isFinal, deckFinished } = body

  if (useSupabase()) {
    return handleSupabase(sessionId, partner, tmdbId, titleType, liked, round,
      isFinal, deckFinished, body.deckSize, body.poolLength)
  }
  return handleStore(sessionId, partner, tmdbId, titleType, liked, round,
    isFinal, deckFinished, body.deckSize, body.poolLength)
}

type StoreT = typeof import('@/lib/store').store

async function handleStore(
  sessionId: string, partner: Partner, tmdbId: number,
  titleType: 'movie' | 'tv', liked: boolean, round: number,
  isFinal?: boolean, deckFinished?: boolean, deckSize?: number, poolLength?: number
) {
  const { store } = await import('@/lib/store')
  const other: Partner = partner === 'a' ? 'b' : 'a'

  // A deckFinished ping records nothing; it only asks for the round-end check.
  if (deckFinished) return storeRoundEnd(store, sessionId, round, deckSize, poolLength)

  // Record the swipe first, then look for the other partner's like. Running the
  // two together would let two simultaneous likes each miss the other.
  await store.addSwipe({
    session_id: sessionId, partner, tmdb_id: tmdbId, title_type: titleType, liked, round,
  })

  if (liked) {
    const hit = await store.findMatchingSwipe(sessionId, tmdbId, titleType, other)
    if (hit) {
      await store.transition(sessionId, ['swiping', 'round2'], {
        status: 'matched', matched_tmdb_id: tmdbId, matched_type: titleType,
      })
      return NextResponse.json({ match: true, tmdbId, titleType })
    }
  }

  // Only the last card of a deck can end a round.
  if (!isFinal) return NextResponse.json({ match: false })
  return storeRoundEnd(store, sessionId, round, deckSize, poolLength)
}

async function storeRoundEnd(
  store: StoreT, sessionId: string,
  round?: number, deckSize?: number, poolLength?: number
) {
  let currentRound = round ?? 1
  let deckA = deckSize ?? 0
  let deckB = deckSize ?? 0
  let pool = poolLength ?? 0

  // The caller normally supplies its deck size and pool length. Without them,
  // measure them from the stored session.
  if (!(round && deckSize && poolLength)) {
    const session = await store.getSession(sessionId)
    if (!session) return NextResponse.json({ match: false })
    if (session.status !== 'swiping' && session.status !== 'round2') {
      return NextResponse.json({ match: false })
    }
    currentRound = session.round
    const slice = (list: unknown[]) =>
      list.slice((currentRound - 1) * DECK_SIZE, currentRound * DECK_SIZE).length
    deckA = slice(session.pool_a)
    deckB = slice(session.pool_b)
    pool = Math.min(session.pool_a.length, session.pool_b.length)
  }

  const counts = await store.countSwipesByPartner(sessionId, currentRound)
  if (counts.a < deckA || counts.b < deckB) return NextResponse.json({ match: false })

  const nextRound = currentRound + 1
  // Round 2 is already sitting in the pool, so advancing is a single status
  // change — nothing is generated or fetched.
  const nextReady = pool - (nextRound - 1) * DECK_SIZE >= MIN_ROUND_DECK

  await store.transition(
    sessionId,
    ['swiping', 'round2'],
    nextReady ? { status: 'round2', round: nextRound } : { status: 'top5' },
    { round: currentRound }
  )

  return NextResponse.json({
    match: false,
    status: nextReady ? 'round2' : 'top5',
    round: nextReady ? nextRound : currentRound,
  })
}

async function handleSupabase(
  sessionId: string, partner: Partner, tmdbId: number,
  titleType: 'movie' | 'tv', liked: boolean, round: number,
  isFinal?: boolean, deckFinished?: boolean,
  deckSize?: number, poolLength?: number
) {
  const { createServerClient } = await import('@/lib/supabase-server')
  const supabase = createServerClient()

  const otherPartner: Partner = partner === 'a' ? 'b' : 'a'

  // A deckFinished ping records nothing; it just asks for the round-end check.
  // It is the reliable trigger — the per-swipe isFinal flag is only a fast path.
  if (deckFinished) {
    return roundEndCheck(supabase, sessionId, partner, otherPartner, round, deckSize, poolLength)
  }

  // The insert and the other partner's like are independent, so overlap them.
  const [, matchLookup] = await Promise.all([
    supabase.from('swipes').insert({
      session_id: sessionId, partner, tmdb_id: tmdbId, title_type: titleType, liked, round
    }),
    liked
      ? supabase.from('swipes').select('liked')
          .eq('session_id', sessionId).eq('tmdb_id', tmdbId)
          .eq('title_type', titleType).eq('partner', otherPartner).eq('liked', true).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (liked) {
    const otherSwipe = matchLookup.data
    if (otherSwipe) {
      await supabase.from('sessions')
        .update({ status: 'matched', matched_tmdb_id: tmdbId, matched_type: titleType })
        .eq('id', sessionId).in('status', ['swiping', 'round2'])
      return NextResponse.json({ match: true, tmdbId, titleType })
    }
  }

  // The round-end check needs the whole session row, including both 30-title
  // pools. Only the last card of a deck can end a round, so skip that read for
  // every other swipe rather than paying for it 30 times.
  if (!isFinal) return NextResponse.json({ match: false })

  return roundEndCheck(supabase, sessionId, partner, otherPartner, round, deckSize, poolLength)
}

async function roundEndCheck(
  supabase: any, sessionId: string, partner: Partner, other: Partner,
  round?: number, deckSize?: number, poolLength?: number
) {
  // The caller usually knows its deck size and the full pool length, which is
  // everything this check needs. Reading the session row instead would pull
  // both decks back over the wire just to measure them.
  if (round && deckSize && poolLength) {
    const [{ count }, { count: otherCount }] = await Promise.all([
      supabase.from('swipes').select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId).eq('partner', partner).eq('round', round),
      supabase.from('swipes').select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId).eq('partner', other).eq('round', round),
    ])
    if ((count ?? 0) < deckSize || (otherCount ?? 0) < deckSize) {
      return NextResponse.json({ match: false })
    }
    const nextRound = round + 1
    const nextReady = poolLength - (nextRound - 1) * DECK_SIZE >= MIN_ROUND_DECK
    await supabase.from('sessions')
      .update(nextReady ? { status: 'round2', round: nextRound } : { status: 'top5' })
      .eq('id', sessionId).eq('round', round).in('status', ['swiping', 'round2'])
    return NextResponse.json({
      match: false,
      status: nextReady ? 'round2' : 'top5',
      round: nextReady ? nextRound : round,
    })
  }

  const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
  if (!session) return NextResponse.json({ match: false })

  const s = rowToSession(session as SessionRow)
  if (s.status !== 'swiping' && s.status !== 'round2') return NextResponse.json({ match: false })

  const deckOf = (p: Partner, round: number) =>
    (p === 'a' ? s.poolA : s.poolB).slice((round - 1) * DECK_SIZE, round * DECK_SIZE)

  const pool = deckOf(partner, s.round)
  const otherPool = deckOf(other, s.round)

  const [{ count }, { count: otherCount }] = await Promise.all([
    supabase.from('swipes').select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId).eq('partner', partner).eq('round', s.round),
    supabase.from('swipes').select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId).eq('partner', other).eq('round', s.round),
  ])

  if ((count ?? 0) >= pool.length) {

    if ((otherCount ?? 0) >= otherPool.length) {
      const nextRound = s.round + 1
      const nextReady =
        deckOf('a', nextRound).length >= MIN_ROUND_DECK &&
        deckOf('b', nextRound).length >= MIN_ROUND_DECK

      // Round 2 is already sitting in the pool, so this is a single status
      // flip — no model call, no TMDB fetch, nothing to wait for.
      await supabase.from('sessions')
        .update(nextReady ? { status: 'round2', round: nextRound } : { status: 'top5' })
        .eq('id', sessionId).eq('status', s.status)

      return NextResponse.json({
        match: false,
        status: nextReady ? 'round2' : 'top5',
        round: nextReady ? nextRound : s.round,
      })
    }
  }

  return NextResponse.json({ match: false })
}
