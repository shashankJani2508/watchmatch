'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startSession() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sessions', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }
      const { sessionId } = await res.json()
      sessionStorage.setItem(`wm_role_${sessionId}`, 'a')
      router.push(`/session/${sessionId}`)
    } catch (e) {
      console.error(e)
      setError(
        e instanceof Error && e.message.includes('fetch')
          ? 'Could not reach the server. Is it running?'
          : (e instanceof Error ? e.message : 'Something went wrong. Check your .env.local keys.')
      )
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 text-center max-w-sm w-full">
        {/* Logo */}
        <div className="mb-2">
          <span className="text-5xl">🎬</span>
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight mb-3">
          Watch<span className="text-primary">Match</span>
        </h1>
        <p className="text-lg text-gray-400 mb-1">Two opinions. One movie. Tonight.</p>
        <p className="text-sm text-gray-500 mb-10">
          Stop scrolling. Stop negotiating. Find something you'll both love.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-sm text-red-300 text-left">
            ⚠️ {error}
          </div>
        )}

        <button
          onClick={startSession}
          disabled={loading}
          className="w-full py-4 bg-primary hover:bg-primary-light disabled:opacity-60 text-white font-semibold text-lg rounded-2xl transition-all duration-200 active:scale-95 shadow-lg shadow-primary/30"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Starting session…
            </span>
          ) : (
            'Start a session'
          )}
        </button>

        <p className="mt-6 text-sm text-gray-500">
          Your partner will join via QR code or link — no accounts needed.
        </p>

        {/* How it works */}
        <div className="mt-12 space-y-4 text-left">
          {[
            { emoji: '🎭', title: 'Set your mood', desc: 'Both partners fill in their vibe for tonight — independently.' },
            { emoji: '🃏', title: 'Swipe together', desc: 'Browse 30 AI-curated titles. Swipe right on what grabs you.' },
            { emoji: '✨', title: 'Instant match', desc: 'When you both like the same title, both screens light up — with exactly where to watch it.' },
          ].map(({ emoji, title, desc }) => (
            <div key={title} className="flex gap-4 p-4 bg-surface rounded-xl">
              <span className="text-2xl flex-shrink-0">{emoji}</span>
              <div>
                <p className="font-semibold text-sm">{title}</p>
                <p className="text-sm text-gray-400 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
