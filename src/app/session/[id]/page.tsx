'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import PreferenceForm from '@/components/PreferenceForm'
import QRCodeShare from '@/components/QRCodeShare'
import WaitingScreen from '@/components/WaitingScreen'
import { Preferences, Session, Partner } from '@/types'
import { getSupabaseClient } from '@/lib/supabase-client'

type UIState =
  | 'loading'
  | 'form'
  | 'submitted_waiting'   // submitted, waiting for other partner
  | 'generating'          // both submitted, Gemini + TMDB running
  | 'not_found'

export default function SessionPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [session, setSession] = useState<Session | null>(null)
  const [partner, setPartner] = useState<Partner | null>(null)
  const [uiState, setUiState] = useState<UIState>('loading')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submittedPrefsRef = useRef<{ partner: Partner; prefs: Preferences } | null>(null)

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  const joinUrl = `${appUrl}/session/${id}?role=b`

  // Determine partner role
  useEffect(() => {
    const roleParm = searchParams.get('role') as Partner | null
    const stored = sessionStorage.getItem(`wm_role_${id}`) as Partner | null

    if (roleParm === 'b') {
      sessionStorage.setItem(`wm_role_${id}`, 'b')
      setPartner('b')
    } else if (stored) {
      setPartner(stored)
    } else {
      // Must be A (created session)
      sessionStorage.setItem(`wm_role_${id}`, 'a')
      setPartner('a')
    }
  }, [id, searchParams])

  const fetchSession = useCallback(async (isInitial = false) => {
    let res: Response
    try {
      res = await fetch(`/api/sessions/${id}`, { cache: 'no-store' })
    } catch {
      // Network blip (common on mobile). A background poll must never tear down
      // the screen the user is currently filling in.
      return null
    }
    if (!res.ok) {
      // Only a confirmed 404 on first load means the session is really gone.
      // Transient 5xx during polling is ignored, otherwise one bad response
      // unmounts the preference form and wipes the user's selections.
      if (isInitial && res.status === 404) setUiState('not_found')
      return null
    }
    const data: Session = await res.json()
    // Keep locally-submitted prefs visible until the server echoes them back,
    // otherwise a stale read remounts the form and wipes the user's choices.
    const local = submittedPrefsRef.current
    const merged: Session = local
      ? {
          ...data,
          partnerAPreferences: data.partnerAPreferences ?? (local.partner === 'a' ? local.prefs : null),
          partnerBPreferences: data.partnerBPreferences ?? (local.partner === 'b' ? local.prefs : null),
        }
      : data
    setSession(merged)
    return merged
  }, [id])

  // Initial load + derive UI state
  useEffect(() => {
    if (!partner) return
    fetchSession(true).then(s => {
      if (!s) return
      deriveUIState(s, partner)
    })
  }, [partner, fetchSession])

  // Realtime (when configured) + polling, which always runs as a safety net
  useEffect(() => {
    if (!partner) return

    const refresh = async () => {
      const s = await fetchSession()
      if (s) deriveUIState(s, partner)
    }

    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null
    // Supabase Realtime rejects the new sb_publishable_ key format, so the socket
    // never connects and just retries. Polling above covers every update; set
    // NEXT_PUBLIC_SUPABASE_REALTIME=true to re-enable once a legacy JWT anon key is in use.
    if (process.env.NEXT_PUBLIC_SUPABASE_REALTIME === 'true') {
      const supabase = getSupabaseClient()
      // payload.new is the raw snake_case row, not a Session — re-read through
      // the API so it goes through rowToSession instead of being mis-cast.
      channel = supabase
        .channel(`session-${id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${id}`,
        }, () => { void refresh() })
        .subscribe()
    }

    const interval = setInterval(refresh, 2500)
    return () => {
      clearInterval(interval)
      if (channel) getSupabaseClient().removeChannel(channel)
    }
  }, [id, partner, fetchSession])

  function deriveUIState(s: Session, p: Partner) {
    if (s.status === 'swiping' || s.status === 'round2') {
      router.replace(`/session/${id}/swipe`)
      return
    }
    if (s.status === 'matched' || s.status === 'top5') {
      router.replace(`/session/${id}/match`)
      return
    }
    if (s.status === 'generating') {
      setUiState('generating')
      return
    }

    const myPrefs = p === 'a' ? s.partnerAPreferences : s.partnerBPreferences
    if (myPrefs) {
      setUiState('submitted_waiting')
    } else if (p === 'b') {
      // Use status (reliably stored) to gate B's form — don't rely on JSONB prefs race
      if (s.status === 'waiting_b') {
        setUiState('submitted_waiting') // A hasn't set up yet
      } else {
        setUiState('form') // status is a_submitted or beyond — A is done, B's turn
      }
    } else {
      setUiState('form')
    }
  }

  async function handleSubmit(prefs: Preferences) {
    if (!partner) return
    setSubmitting(true)
    setSubmitError(null)
    submittedPrefsRef.current = { partner, prefs }
    try {
      const res = await fetch(`/api/preferences/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner, preferences: prefs }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)
      // Optimistically update session so the waiting UI shows immediately
      setSession(prev => prev ? {
        ...prev,
        ...(partner === 'a' ? { partnerAPreferences: prefs } : { partnerBPreferences: prefs }),
      } : prev)
      try { sessionStorage.removeItem(`wm_draft_${id}_${partner}`) } catch { /* ignore */ }
      if (data.status === 'generating' || data.status === 'swiping') {
        setUiState('generating')
      } else {
        setUiState('submitted_waiting')
      }
    } catch (e) {
      submittedPrefsRef.current = null
      setSubmitError(e instanceof Error ? e.message : 'Could not save your preferences. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (uiState === 'loading') {
    return <PageShell><WaitingScreen message="Loading session…" /></PageShell>
  }

  if (uiState === 'not_found') {
    return (
      <PageShell>
        <div className="text-center py-20">
          <p className="text-3xl mb-3">🤷</p>
          <p className="font-bold text-lg mb-2">Session not found</p>
          <p className="text-gray-400 text-sm">
            This link may have expired. Ask your partner to start a new session.
          </p>
        </div>
      </PageShell>
    )
  }

  if (uiState === 'generating') {
    return (
      <PageShell>
        <WaitingScreen
          message="Finding titles you'll both love…"
          subMessage="Gemini is curating a personalised list. This takes about 15 seconds."
        />
      </PageShell>
    )
  }

  const isA = partner === 'a'

  if (uiState === 'submitted_waiting' && isA && session?.partnerAPreferences) {
    // A is done — show QR code
    return (
      <PageShell>
        <div className="py-4">
          <div className="mb-8 p-4 bg-success/15 border border-success/30 rounded-xl text-center">
            <p className="text-success font-semibold">✓ Your preferences are saved</p>
          </div>
          <QRCodeShare url={joinUrl} sessionId={id} />
          <div className="mt-8 text-center">
            <WaitingScreen
              message="Waiting for your partner…"
              subMessage="They'll fill in their preferences — you won't see them until you're both ready."
            />
          </div>
        </div>
      </PageShell>
    )
  }

  if (uiState === 'submitted_waiting' && !isA) {
    // Use status to decide: waiting_b means A hasn't set up yet
    if (!session || session.status === 'waiting_b') {
      return (
        <PageShell>
          <WaitingScreen
            message="Your partner is still setting up…"
            subMessage="They'll invite you in just a moment."
          />
        </PageShell>
      )
    }
    return (
      <PageShell>
        <div className="p-4 bg-success/15 border border-success/30 rounded-xl text-center">
          <p className="text-success font-semibold">✓ You're all set!</p>
          <p className="text-sm text-gray-400 mt-1">Waiting for your partner to finish…</p>
        </div>
      </PageShell>
    )
  }

  // Show preference form
  return (
    <PageShell>
      {submitError && (
        <div className="mb-4 p-3 bg-danger/20 border border-danger/40 rounded-xl text-sm text-danger">
          ⚠️ {submitError}
        </div>
      )}
      <PreferenceForm
        storageKey={`wm_draft_${id}_${partner}`}
        onSubmit={handleSubmit}
        loading={submitting}
        partnerLabel={isA ? "Your preferences" : "Your preferences"}
      />
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="px-4 py-4 border-b border-white/5">
        <h1 className="text-xl font-bold">
          Watch<span className="text-primary">Match</span>
        </h1>
      </header>
      <div className="max-w-md mx-auto px-4 pt-6">{children}</div>
    </div>
  )
}
