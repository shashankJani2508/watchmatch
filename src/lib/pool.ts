import { Preferences, Title, ERA_BOUNDS } from '../types'
import type { SearchBrief } from './gemini'

// A deck this small is still better than one that ignores what the users chose.
const MIN_USABLE = 1

export interface Pools {
  poolA: Title[]
  poolB: Title[]
}

function matchesPrefs(t: Title, prefA: Preferences, prefB: Preferences): boolean {
  const minRating = Math.max(prefA.minRating, prefB.minRating)
  if (t.imdbRating < minRating) return false
  // The demo pool is movies only, so a series-only request must not match it.
  const types = [...new Set([...(prefA.contentTypes ?? []), ...(prefB.contentTypes ?? [])])]
  if (types.length > 0 && !types.includes(t.type)) return false
  const eras = [...new Set([...prefA.eras, ...prefB.eras])]
  if (eras.length === 0) return true
  return eras.some(e => {
    const b = ERA_BOUNDS[e]
    return b ? t.year >= b.from && t.year <= b.to : true
  })
}

export async function buildPool(
  prefA: Preferences,
  prefB: Preferences,
  seenIds: number[],
  round: number
): Promise<Pools> {
  const { getDemoPool } = await import('./tmdb')

  // The demo pool is a fixed list, so it has to be filtered against the users'
  // choices too — otherwise falling back quietly serves titles they excluded.
  const fallback = (): Pools => {
    const demo = getDemoPool()
    const seen = new Set(seenIds)
    const usable = (list: Title[]) =>
      list.filter(t => !seen.has(t.tmdbId) && matchesPrefs(t, prefA, prefB))
    const a = usable(demo.poolA)
    const b = usable(demo.poolB)
    if (a.length >= MIN_USABLE && b.length >= MIN_USABLE) return { poolA: a, poolB: b }
    console.error('[WatchMatch] no titles match these preferences, even in the demo pool')
    return { poolA: a, poolB: b }
  }

  if (!process.env.GEMINI_API_KEY || !process.env.TMDB_API_READ_ACCESS_TOKEN) {
    console.log('[WatchMatch] Demo mode — add GEMINI_API_KEY + TMDB_API_READ_ACCESS_TOKEN for real recommendations')
    return fallback()
  }

  try {
    const { generateSearchBrief, generateRound2Brief } = await import('./gemini')
    const { fetchTitlePool } = await import('./tmdb')

    // The brief is only a hint (sort order, and genres when nobody picked any).
    // If Gemini is down, out of quota, or the key has expired, carry on with
    // TMDB rather than throwing away the whole deck.
    let brief: SearchBrief = { genres: [], sortBy: 'vote_average.desc', notes: '' }
    try {
      brief =
        round === 1
          ? await generateSearchBrief(prefA, prefB)
          : { ...(await generateRound2Brief(prefA, prefB, 0, 0, 0)), notes: '' }
    } catch (e) {
      console.error('[WatchMatch] Gemini brief failed, continuing without it:', e)
    }

    const pools = await fetchTitlePool(prefA, prefB, brief, seenIds, round)
    if (pools.poolA.length >= MIN_USABLE && pools.poolB.length >= MIN_USABLE) return pools

    // Nothing exists in the chosen language for this era/rating. Widening the
    // language keeps era and rating intact and keeps the titles real, which
    // beats serving a hardcoded list that matches none of their choices.
    console.error('[WatchMatch] no titles in the chosen language; widening language only')
    const anyLang = await fetchTitlePool(
      { ...prefA, languages: [] }, { ...prefB, languages: [] }, brief, seenIds, round
    )
    if (anyLang.poolA.length >= MIN_USABLE) return anyLang

    return fallback()
  } catch (e) {
    console.error('[WatchMatch] pool build failed:', e)
    return fallback()
  }
}
