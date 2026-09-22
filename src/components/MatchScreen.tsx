'use client'

import { useEffect, useState, useRef } from 'react'
import { Title, OTTPlatform } from '@/types'

interface Props {
  title: Title
  sessionId: string
}

export default function MatchScreen({ title, sessionId }: Props) {
  const [platforms, setPlatforms] = useState<OTTPlatform[]>([])
  const [ottLoading, setOttLoading] = useState(true)
  const [rating, setRating] = useState<number | null>(null)
  const [rated, setRated] = useState(false)
  const confettiFired = useRef(false)

  // Fire confetti
  useEffect(() => {
    if (confettiFired.current) return
    confettiFired.current = true

    import('canvas-confetti').then(({ default: confetti }) => {
      const end = Date.now() + 2500
      const colors = ['#7c3aed', '#f59e0b', '#10b981', '#ffffff']

      function frame() {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors })
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors })
        if (Date.now() < end) requestAnimationFrame(frame)
      }
      frame()
    })
  }, [])

  // Fetch OTT availability
  useEffect(() => {
    setOttLoading(true)
    fetch(`/api/ott/${title.tmdbId}?type=${title.type}`)
      .then(r => r.json())
      .then(d => setPlatforms(d.platforms ?? []))
      .catch(() => {})
      .finally(() => setOttLoading(false))
  }, [title.tmdbId, title.type])

  async function submitRating(score: number) {
    setRating(score)
    try {
      await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, tmdbId: title.tmdbId, titleType: title.type, score }),
      })
      setRated(true)
    } catch {}
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col w-full max-w-md mx-auto">
      {/* Hero with backdrop/poster */}
      <div className="relative h-72 flex-shrink-0">
        {title.backdropPath ? (
          <img
            src={title.backdropPath}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src={title.posterPath}
            alt=""
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-bg" />

        {/* Match badge */}
        <div className="absolute top-4 left-0 right-0 flex justify-center">
          <div className="bg-primary text-white font-bold text-sm px-5 py-1.5 rounded-full shadow-lg shadow-primary/40 glow">
            ✨ It's a match!
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 pb-10 -mt-6 relative w-full">
        {/* Poster + title */}
        <div className="flex gap-4 items-end mb-5">
          <img
            src={title.posterPath}
            alt={title.title}
            className="w-24 rounded-xl shadow-xl flex-shrink-0 border-2 border-white/10"
          />
          <div>
            <h1 className="text-2xl font-extrabold text-white leading-tight">{title.title}</h1>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
              <span>{title.year}</span>
              <span>·</span>
              <span className="text-accent font-semibold">★ {title.imdbRating}</span>
              {title.runtime && (
                <>
                  <span>·</span>
                  <span>{title.runtime}m</span>
                </>
              )}
              {title.type === 'tv' && (
                <>
                  <span>·</span>
                  <span className="text-xs bg-white/15 px-2 py-0.5 rounded-full">Series</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {title.genres.slice(0, 4).map(g => (
                <span key={g} className="text-xs bg-surface2 text-gray-300 px-2 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Synopsis */}
        {title.synopsis && (
          <p className="text-gray-300 text-sm leading-relaxed mb-6">{title.synopsis}</p>
        )}

        {/* OTT platforms */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Watch now in India
          </p>
          {ottLoading ? (
            <p className="text-gray-500 text-sm">Checking availability…</p>
          ) : platforms.length === 0 ? (
            <p className="text-gray-500 text-sm">
              Not on any streaming service in India right now.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {platforms.map(p => (
                <a
                  key={p.service + p.streamingType}
                  href={p.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-surface2 hover:bg-surface rounded-xl text-sm font-medium transition-all active:scale-95 border border-white/10"
                >
                  {p.logo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.logo} alt="" className="w-5 h-5 rounded" />
                  )}
                  <span>{p.serviceName}</span>
                  {p.streamingType !== 'subscription' && (
                    <span className="text-xs text-gray-500">({p.streamingType})</span>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Rating */}
        <div className="p-4 bg-surface rounded-2xl">
          <p className="text-sm font-semibold mb-3">
            {rated ? '🎉 Thanks for rating!' : 'Rate it after you watch'}
          </p>
          {!rated && (
            <div className="flex gap-2 justify-center">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => submitRating(star)}
                  className={`text-2xl transition-transform active:scale-90 ${
                    rating !== null && star <= rating ? 'text-accent' : 'text-gray-600 hover:text-accent'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          )}
          {rated && (
            <p className="text-center text-sm text-gray-400">
              Your rating helps us pick better matches next time.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
