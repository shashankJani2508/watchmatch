'use client'

import { useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import SwipeCard from './SwipeCard'
import { Title, Partner } from '@/types'

interface Props {
  titles: Title[]
  sessionId: string
  partner: Partner
  round: number
  onAllSwiped: () => void
}

export default function SwipeDeck({ titles, sessionId, partner, round, onAllSwiped }: Props) {
  const [index, setIndex] = useState(0)
  const pendingWrites = useRef<Promise<unknown>[]>([])
  const [liked, setLiked] = useState(0)
  const [passed, setPassed] = useState(0)

  const current = titles[index]
  const remaining = titles.length - index
  const progress = Math.round((index / titles.length) * 100)

  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    if (!current) return

    const isLike = direction === 'right'
    if (isLike) setLiked(prev => prev + 1)
    else setPassed(prev => prev + 1)

    // Advance immediately. Recording the swipe is a background write, and
    // waiting on it made every card feel like it hung. A match arrives via the
    // parent page's polling, which navigates away on its own.
    const nextIndex = index + 1
    setIndex(nextIndex)

    const write = fetch('/api/swipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        partner,
        tmdbId: current.tmdbId,
        titleType: current.type,
        liked: isLike,
        round,
        isFinal: nextIndex >= titles.length,
      }),
    }).catch(e => console.error('Swipe record failed:', e))
    pendingWrites.current.push(write)

    // Swipes are recorded in the background, so the round-end check has to wait
    // for them — otherwise it counts too few and the round never advances.
    if (nextIndex >= titles.length) {
      void Promise.allSettled(pendingWrites.current).then(() => onAllSwiped())
    }
  }, [current, index, titles.length, sessionId, partner, round, onAllSwiped])

  // Tap buttons for accessibility and desktop
  function tapLike() { handleSwipe('right') }
  function tapPass() { handleSwipe('left') }

  if (index >= titles.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="text-5xl mb-4">🍿</div>
        <p className="text-xl font-bold mb-2">You've seen them all!</p>
        <p className="text-gray-400 text-sm">Waiting for your partner to finish…</p>
        <div className="mt-6 flex gap-6 text-sm text-gray-400">
          <span>👍 {liked} liked</span>
          <span>👎 {passed} passed</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full max-w-md mx-auto">
      {/* Progress bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
          <span>{remaining} left</span>
          <span className="font-medium text-gray-300">
            {round === 2 ? 'Round 2 · ' : ''}{titles.length} titles
          </span>
          <span>{liked} liked</span>
        </div>
        <div className="h-1 bg-surface2 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card stack */}
      <div className="flex-1 min-h-0 relative mx-4 mt-2">
        <AnimatePresence>
          {[2, 1, 0].map(offset => {
            const cardIndex = index + offset
            if (cardIndex >= titles.length) return null
            return (
              <SwipeCard
                key={titles[cardIndex].tmdbId}
                title={titles[cardIndex]}
                isTop={offset === 0}
                stackPosition={offset}
                onSwipe={offset === 0 ? handleSwipe : undefined}
              />
            )
          })}
        </AnimatePresence>
      </div>

      {/* Action buttons */}
      <div className="flex justify-center items-center gap-6 py-4 px-4 flex-shrink-0">
        <button
          onClick={tapPass}
          disabled={!current}
          className="w-16 h-16 rounded-full bg-surface2 hover:bg-danger/20 border-2 border-danger/40 text-danger flex items-center justify-center text-2xl transition-all active:scale-90 disabled:opacity-40"
          aria-label="Pass"
        >
          ✕
        </button>
        <div className="flex flex-col items-center justify-center text-xs text-gray-500">
          <span>swipe</span>
        </div>
        <button
          onClick={tapLike}
          disabled={!current}
          className="w-16 h-16 rounded-full bg-surface2 hover:bg-success/20 border-2 border-success/40 text-success flex items-center justify-center text-2xl transition-all active:scale-90 disabled:opacity-40"
          aria-label="Like"
        >
          ♥
        </button>
      </div>
    </div>
  )
}
