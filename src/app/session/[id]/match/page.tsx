'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import MatchScreen from '@/components/MatchScreen'
import WaitingScreen from '@/components/WaitingScreen'
import { Session, Title, OTTPlatform } from '@/types'

export default function MatchPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [matchedTitle, setMatchedTitle] = useState<Title | null>(null)
  const [topFive, setTopFive] = useState<Title[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/sessions/${id}`)
      if (!res.ok) { router.replace('/'); return }
      const s: Session = await res.json()
      setSession(s)

      if (s.status === 'matched' && s.matchedTmdbId && s.matchedType) {
        // Find the title in the pool
        const allTitles = [...s.poolA, ...s.poolB]
        const found = allTitles.find(
          t => t.tmdbId === s.matchedTmdbId && t.type === s.matchedType
        )
        if (found) {
          setMatchedTitle(found)
        } else {
          // Fetch details from TMDB directly
          const detail = await fetch(
            `/api/ott/${s.matchedTmdbId}?type=${s.matchedType}`
          ).catch(() => null)
          // Minimal fallback
          setMatchedTitle({
            tmdbId: s.matchedTmdbId,
            type: s.matchedType,
            title: 'Your Match',
            year: 0,
            imdbRating: 0,
            runtime: null,
            synopsis: '',
            posterPath: '',
            backdropPath: null,
            genres: [],
          })
        }
      } else if (s.status === 'top5') {
        // Compute top 5 by combined like score from both pools
        const allTitles = [...new Map(
          [...s.poolA, ...s.poolB].map(t => [t.tmdbId, t])
        ).values()]
        // We don't have swipe data client-side; show all titles from pool
        // sorted by rating as a reasonable proxy
        setTopFive(allTitles.sort((a, b) => b.imdbRating - a.imdbRating).slice(0, 5))
      }

      setLoading(false)
    }
    load()
  }, [id, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <WaitingScreen message="Preparing your match…" />
      </div>
    )
  }

  if (session?.status === 'matched' && matchedTitle) {
    return <MatchScreen title={matchedTitle} sessionId={id} />
  }

  if (session?.status === 'top5' && topFive.length > 0) {
    return <TopFive titles={topFive} sessionId={id} />
  }

  // Fallback
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 text-center">
      <div>
        <p className="text-4xl mb-4">🤝</p>
        <p className="font-bold text-xl mb-2">Session complete</p>
        <p className="text-gray-400 text-sm mb-6">Something went wrong loading your match.</p>
        <button
          onClick={() => router.replace('/')}
          className="py-3 px-6 bg-primary rounded-xl text-sm font-medium"
        >
          Start a new session
        </button>
      </div>
    </div>
  )
}

function TopFive({ titles, sessionId }: { titles: Title[]; sessionId: string }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="px-4 py-4 border-b border-white/5">
        <h1 className="text-xl font-bold">Watch<span className="text-primary">Match</span></h1>
      </header>
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <p className="text-3xl mb-2">🤔</p>
          <h2 className="text-xl font-bold mb-1">No automatic match — but here are your top picks</h2>
          <p className="text-sm text-gray-400">
            These got the most combined interest. Talk it over and pick together.
          </p>
        </div>
        <div className="space-y-3">
          {titles.map((t, i) => (
            <TopFiveRow key={t.tmdbId} title={t} index={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TopFiveRow({ title, index }: { title: Title; index: number }) {
  const [open, setOpen] = useState(false)
  const [platforms, setPlatforms] = useState<OTTPlatform[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleToggle() {
    const next = !open
    setOpen(next)
    if (!next || platforms !== null || loading) return

    setLoading(true)
    try {
      const res = await fetch(`/api/ott/${title.tmdbId}?type=${title.type}`)
      const data = await res.json()
      setPlatforms(data.platforms ?? [])
    } catch {
      setPlatforms([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl overflow-hidden">
      <button
        onClick={handleToggle}
        aria-expanded={open}
        className="w-full flex gap-3 p-3 text-left hover:bg-surface2 transition-colors active:scale-[0.99]"
      >
        <span className="text-2xl font-black text-gray-500 w-8 flex-shrink-0 flex items-center">
          {index + 1}
        </span>
        {title.posterPath && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={title.posterPath}
            alt={title.title}
            className="w-14 h-20 object-cover rounded-lg flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{title.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {title.year} · ★ {title.imdbRating} · {title.type === 'tv' ? 'Series' : 'Movie'}
          </p>
          <p className={`text-xs text-gray-500 mt-1 ${open ? '' : 'line-clamp-2'}`}>
            {title.synopsis}
          </p>
          <p className="text-xs text-primary mt-1.5 font-medium">
            {open ? 'Hide' : 'Where to watch'} {open ? '▲' : '▼'}
          </p>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-2">
            Watch now in India
          </p>
          {loading ? (
            <p className="text-gray-500 text-sm">Checking availability…</p>
          ) : platforms && platforms.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {platforms.map(p => (
                <a
                  key={p.service + p.streamingType}
                  href={p.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 bg-surface2 hover:bg-surface rounded-lg text-xs font-medium transition-all active:scale-95 border border-white/10"
                >
                  {p.logo && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.logo} alt="" className="w-4 h-4 rounded" />
                  )}
                  <span>{p.serviceName}</span>
                  {p.streamingType !== 'subscription' && (
                    <span className="text-gray-500">({p.streamingType})</span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              Not on any streaming service in India right now.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
