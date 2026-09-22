'use client'

import { useState, useEffect } from 'react'
import { Preferences, Genre, Language, Industry, ContentType, MinRating, Era } from '@/types'

interface Props {
  onSubmit: (prefs: Preferences) => void
  loading: boolean
  partnerLabel: string
  storageKey?: string
}

const GENRES: { value: Genre; label: string; emoji: string }[] = [
  { value: 'action', label: 'Action', emoji: '💥' },
  { value: 'adventure', label: 'Adventure', emoji: '🧭' },
  { value: 'comedy', label: 'Comedy', emoji: '😂' },
  { value: 'drama', label: 'Drama', emoji: '🎭' },
  { value: 'romance', label: 'Romance', emoji: '💕' },
  { value: 'thriller', label: 'Thriller', emoji: '😳' },
  { value: 'horror', label: 'Horror', emoji: '👻' },
  { value: 'mystery', label: 'Mystery', emoji: '🔎' },
  { value: 'crime', label: 'Crime', emoji: '🕵️' },
  { value: 'scifi', label: 'Sci-Fi', emoji: '🚀' },
  { value: 'fantasy', label: 'Fantasy', emoji: '🐉' },
  { value: 'historical', label: 'Historical', emoji: '🏛' },
]

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'hindi', label: 'Hindi' },
  { value: 'english', label: 'English' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'telugu', label: 'Telugu' },
  { value: 'kannada', label: 'Kannada' },
  { value: 'gujarati', label: 'Gujarati' },
  { value: 'korean', label: 'Korean' },
  { value: 'french', label: 'French' },
]

const INDUSTRIES: { value: Industry; label: string; emoji: string }[] = [
  { value: 'hollywood', label: 'Hollywood', emoji: '🎬' },
  { value: 'bollywood', label: 'Bollywood', emoji: '🪔' },
  { value: 'korean', label: 'Korean', emoji: '🇰🇷' },
  { value: 'turkish', label: 'Turkish', emoji: '🇹🇷' },
  { value: 'chinese', label: 'Chinese', emoji: '🇨🇳' },
]

const RATINGS: { value: MinRating; label: string; note?: string }[] = [
  { value: 6, label: '6+' },
  { value: 7, label: '7+' },
  { value: 8, label: '8+' },
  { value: 9, label: '9+', note: 'very few titles' },
]

const ERAS: { value: Era; label: string }[] = [
  { value: 'pre2000', label: 'Pre-2000' },
  { value: '2000_2005', label: '2000–2005' },
  { value: '2006_2010', label: '2006–2010' },
  { value: '2011_2015', label: '2011–2015' },
  { value: '2016_2020', label: '2016–2020' },
  { value: '2021_2023', label: '2021–2023' },
  { value: '2024_2026', label: '2024–2026' },
]

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]
}

interface Draft {
  genres: Genre[]
  moodText: string
  languages: Language[]
  anyLang: boolean
  industries: Industry[]
  anyIndustry: boolean
  contentTypes: ContentType[]
  minRating: MinRating
  eras: Era[]
  anyEra: boolean
}

// Selections survive a remount or reload: this form sits under a screen that
// re-renders from polling and realtime, and losing a filled-in form to a
// transient refresh is far worse than a stale draft.
function loadDraft(key: string | undefined): Partial<Draft> {
  if (!key || typeof window === 'undefined') return {}
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Partial<Draft>
  } catch {
    return {}
  }
}

export default function PreferenceForm({ onSubmit, loading, partnerLabel, storageKey }: Props) {
  const saved = loadDraft(storageKey)
  const [genres, setGenres] = useState<Genre[]>(saved.genres ?? [])
  const [moodText, setMoodText] = useState(saved.moodText ?? '')
  const [languages, setLanguages] = useState<Language[]>(saved.languages ?? [])
  const [anyLang, setAnyLang] = useState(saved.anyLang ?? true)
  const [industries, setIndustries] = useState<Industry[]>(saved.industries ?? [])
  const [anyIndustry, setAnyIndustry] = useState(saved.anyIndustry ?? true)
  const [contentTypes, setContentTypes] = useState<ContentType[]>(saved.contentTypes ?? ['movie'])
  const [minRating, setMinRating] = useState<MinRating>(saved.minRating ?? 7)
  const [eras, setEras] = useState<Era[]>(saved.eras ?? [])
  const [anyEra, setAnyEra] = useState(saved.anyEra ?? true)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!storageKey) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        genres, moodText, languages, anyLang, industries, anyIndustry,
        contentTypes, minRating, eras, anyEra,
      }))
    } catch { /* private mode / quota — the form still works in memory */ }
  }, [storageKey, genres, moodText, languages, anyLang, industries, anyIndustry,
      contentTypes, minRating, eras, anyEra])

  function handleLangToggle(lang: Language) {
    setAnyLang(false)
    setLanguages(prev => toggle(prev, lang))
  }

  function handleAnyLang() {
    setAnyLang(true)
    setLanguages([])
  }

  function handleIndustryToggle(ind: Industry) {
    setAnyIndustry(false)
    setIndustries(prev => toggle(prev, ind))
  }

  function handleAnyIndustry() {
    setAnyIndustry(true)
    setIndustries([])
  }

  function handleEraToggle(era: Era) {
    setAnyEra(false)
    setEras(prev => toggle(prev, era))
  }

  function handleAnyEra() {
    setAnyEra(true)
    setEras([])
  }

  function handleSubmit() {
    const errs: string[] = []
    if (genres.length === 0) errs.push('Pick at least one genre')
    if (contentTypes.length === 0) errs.push('Pick movies, series, or both')
    if (errs.length > 0) { setErrors(errs); return }

    onSubmit({
      genres,
      moodText: moodText.trim(),
      languages: anyLang ? [] : languages,
      industries: anyIndustry ? [] : industries,
      contentTypes,
      minRating,
      eras: anyEra ? [] : eras,
    })
  }

  return (
    <div className="pb-24">
      <h2 className="text-xl font-bold mb-1">{partnerLabel}</h2>
      <p className="text-gray-400 text-sm mb-8">What are you in the mood for tonight?</p>

      {/* Genre */}
      <Section title="Genre" required>
        <div className="flex flex-wrap gap-2">
          {GENRES.map(({ value, label, emoji }) => (
            <button
              key={value}
              className={`chip ${genres.includes(value) ? 'selected' : ''}`}
              onClick={() => setGenres(prev => toggle(prev, value))}
            >
              {emoji} {label}
            </button>
          ))}
        </div>
      </Section>

      {/* Mood free text */}
      <Section title="Describe the vibe (optional)">
        <textarea
          value={moodText}
          onChange={e => setMoodText(e.target.value)}
          placeholder="e.g. Something that doesn't require too much thinking, maybe a bit of laughs…"
          className="w-full bg-surface2 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/50 transition"
          rows={3}
          maxLength={300}
        />
      </Section>

      {/* Language */}
      <Section title="Language">
        <div className="flex flex-wrap gap-2">
          <button
            className={`chip ${anyLang ? 'selected' : ''}`}
            onClick={handleAnyLang}
          >
            Any
          </button>
          {LANGUAGES.map(({ value, label }) => (
            <button
              key={value}
              className={`chip ${!anyLang && languages.includes(value) ? 'selected' : ''}`}
              onClick={() => handleLangToggle(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      {/* Industry */}
      <Section title="Industry">
        <div className="flex flex-wrap gap-2">
          <button
            className={`chip ${anyIndustry ? 'selected' : ''}`}
            onClick={handleAnyIndustry}
          >
            Any
          </button>
          {INDUSTRIES.map(({ value, label, emoji }) => (
            <button
              key={value}
              className={`chip ${!anyIndustry && industries.includes(value) ? 'selected' : ''}`}
              onClick={() => handleIndustryToggle(value)}
            >
              {emoji} {label}
            </button>
          ))}
        </div>
      </Section>

      {/* Content type */}
      <Section title="Movies or series" required>
        <div className="flex gap-2">
          {([
            { value: 'movie' as ContentType, label: '🎬 Movies' },
            { value: 'tv' as ContentType, label: '📺 Series' },
          ]).map(({ value, label }) => (
            <button
              key={value}
              className={`chip flex-1 text-center ${contentTypes.includes(value) ? 'selected' : ''}`}
              onClick={() => setContentTypes(prev => toggle(prev, value))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">Pick both to mix them together.</p>
      </Section>

      {/* Minimum rating */}
      <Section title="Minimum IMDb rating">
        <div className="flex gap-2">
          {RATINGS.map(({ value, label, note }) => (
            <button
              key={value}
              className={`chip flex-1 text-center relative ${minRating === value ? 'selected' : ''}`}
              onClick={() => setMinRating(value)}
            >
              {label}
              {note && (
                <span className="absolute -top-1 -right-1 bg-accent text-[9px] text-black font-bold px-1 rounded-full leading-tight">
                  few
                </span>
              )}
            </button>
          ))}
        </div>
      </Section>

      {/* Era */}
      <Section title="Era">
        <div className="flex flex-wrap gap-2">
          <button
            className={`chip ${anyEra ? 'selected' : ''}`}
            onClick={handleAnyEra}
          >
            Any era
          </button>
          {ERAS.map(({ value, label }) => (
            <button
              key={value}
              className={`chip ${!anyEra && eras.includes(value) ? 'selected' : ''}`}
              onClick={() => handleEraToggle(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      {errors.length > 0 && (
        <div className="mb-4 p-3 bg-danger/20 border border-danger/40 rounded-xl text-sm text-danger">
          {errors.map(e => <p key={e}>{e}</p>)}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-4 bg-primary hover:bg-primary-light disabled:opacity-60 text-white font-semibold text-lg rounded-2xl transition-all duration-200 active:scale-95 shadow-lg shadow-primary/30"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Saving…
          </span>
        ) : (
          "I'm ready →"
        )}
      </button>
    </div>
  )
}

function Section({ title, required, children }: { title: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <p className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-1">
        {title}
        {required && <span className="text-danger">*</span>}
      </p>
      {children}
    </div>
  )
}
