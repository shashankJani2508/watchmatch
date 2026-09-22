'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import SwipeDeck from '@/components/SwipeDeck'
import WaitingScreen from '@/components/WaitingScreen'
import { Title, Session, Partner, DECK_SIZE } from '@/types'

function deckFor(s: Session, p: Partner, round = s.round): Title[] {
  const full = p === 'a' ? s.poolA : s.poolB
  return full.slice((round - 1) * DECK_SIZE, round * DECK_SIZE)
}

export default function SwipePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [partner, setPartner] = useState<Partner | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [pool, setPool] = useState<Title[]>([])
  const [allSwiped, setAllSwiped] = useState(false)
  const [loading, setLoading] = useState(true)
  const lastRoundRef = useRef<number>(1)
  const allSwipedRef = useRef(false)
  const deckSizeRef = useRef(0)
  const poolLengthRef = useRef(0)

  // Get partner role
  useEffect(() => {
    const stored = sessionStorage.getItem(`wm_role_${id}`) as Partner | null
    setPartner(stored ?? 'a')
  }, [id])

  // Fetch session
  const fetchSession = useCallback(async () => {
    const res = await fetch(`/api/sessions/${id}`)
    if (!res.ok) { router.replace('/'); return null }
    const data: Session = await res.json()
    return data
  }, [id, router])

  useEffect(() => {
    if (!partner) return
    fetchSession().then(s => {
      if (!s) return
      setSession(s)
      setPool(deckFor(s, partner))
      setLoading(false)
    })
  }, [partner, fetchSession])

  // The whole pool was downloaded up front, so a new round is a local slice —
  // no fetch, no spinner.
  const advanceTo = useCallback((round: number) => {
    if (!partner) return
    setSession(prev => {
      if (!prev) return prev
      const deck = deckFor(prev, partner, round)
      if (deck.length === 0) return prev
      setPool(deck)
      allSwipedRef.current = false
      setAllSwiped(false)
      setLoading(false)
      return { ...prev, round }
    })
  }, [partner])

  // Poll the lightweight status endpoint; only pull the full session (which
  // carries the decks) when the round actually advances.
  useEffect(() => {
    if (!partner) return
    let cancelled = false

    const refresh = async () => {
      let st: { status: string; round: number }
      try {
        const res = await fetch(`/api/sessions/${id}/status`, { cache: 'no-store' })
        if (!res.ok) return
        st = await res.json()
      } catch {
        return
      }
      if (cancelled) return

      if (st.status === 'matched' || st.status === 'top5') {
        router.replace(`/session/${id}/match`)
        return
      }

      if (st.round !== lastRoundRef.current) {
        lastRoundRef.current = st.round
        advanceTo(st.round)
        return
      }

      // Still waiting on the other partner: re-ask for the round-end check.
      // It's idempotent and only flips once both decks are genuinely done.
      if (allSwipedRef.current) {
        try {
          const r = await fetch('/api/swipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: id, partner, round: st.round, deckFinished: true,
              deckSize: deckSizeRef.current, poolLength: poolLengthRef.current,
            }),
          })
          const d = await r.json()
          if (!cancelled && d?.status === 'round2' && d.round !== lastRoundRef.current) {
            lastRoundRef.current = d.round
            advanceTo(d.round)
          }
        } catch { /* next tick will retry */ }
      }
    }

    const interval = setInterval(refresh, 2500)
    return () => { cancelled = true; clearInterval(interval) }
  }, [id, partner, fetchSession, router])


  useEffect(() => { allSwipedRef.current = allSwiped }, [allSwiped])
  useEffect(() => { deckSizeRef.current = pool.length }, [pool])
  useEffect(() => {
    if (!partner || !session) return
    poolLengthRef.current = (partner === 'a' ? session.poolA : session.poolB).length
  }, [partner, session])

  // Prevent pull-to-refresh while swiping
  useEffect(() => {
    document.body.classList.add('no-overscroll')
    return () => document.body.classList.remove('no-overscroll')
  }, [])

  if (!loading && partner && pool.length === 0 && session) {
    return (
      <div className="h-dvh bg-bg flex flex-col overflow-hidden">
        <SwipeHeader sessionId={id} round={session.round} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-xl font-bold mb-2">Nothing matched your filters</p>
          <p className="text-gray-400 text-sm">
            Try a wider year range, more languages, or a lower rating, then start a new session.
          </p>
        </div>
      </div>
    )
  }

  if (loading || !partner || pool.length === 0) {
    return (
      <div className="h-dvh bg-bg flex flex-col overflow-hidden">
        <SwipeHeader sessionId={id} round={session?.round ?? 1} />
        <div className="flex-1">
          <WaitingScreen message="Loading your deck…" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh bg-bg flex flex-col overflow-hidden">
      <SwipeHeader sessionId={id} round={session?.round ?? 1} />
      <div className="flex-1 min-h-0">
        <SwipeDeck
          key={session?.round ?? 1}
          titles={pool}
          sessionId={id}
          partner={partner}
          round={session?.round ?? 1}
          onAllSwiped={() => {
            setAllSwiped(true)
            void fetch('/api/swipe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: id, partner, round: session?.round ?? 1, deckFinished: true,
                deckSize: pool.length,
                poolLength: (partner === 'a' ? session?.poolA : session?.poolB)?.length ?? 0,
              }),
            })
              .then(r => r.json())
              .then(d => {
                if (d?.status === 'round2' && d.round) {
                  lastRoundRef.current = d.round
                  advanceTo(d.round)
                }
              })
              .catch(() => {})
          }}
        />
      </div>
    </div>
  )
}

function SwipeHeader({ sessionId, round }: { sessionId: string; round: number }) {
  return (
    <header className="px-4 py-3 flex items-center justify-between border-b border-white/5 flex-shrink-0">
      <h1 className="text-lg font-bold">
        Watch<span className="text-primary">Match</span>
      </h1>
      {round > 1 && (
        <span className="text-xs bg-accent/20 text-accent px-3 py-1 rounded-full font-semibold">
          Round {round}
        </span>
      )}
    </header>
  )
}
