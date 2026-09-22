// One genre per concept, no overlaps — a title is matched if it carries any of
// the chosen genres, and the list covers the space users actually ask for.
export type Genre =
  | 'action' | 'adventure' | 'comedy' | 'drama' | 'romance' | 'thriller'
  | 'horror' | 'mystery' | 'crime' | 'scifi' | 'fantasy' | 'historical'

export type Language =
  | 'hindi' | 'english' | 'tamil' | 'telugu' | 'kannada'
  | 'gujarati' | 'korean' | 'french'

// Where the film was made. Distinct from language: a Korean-language film can
// be a Hollywood production, so these filter independently.
export type Industry = 'hollywood' | 'bollywood' | 'turkish' | 'korean' | 'chinese'

// Contiguous, non-overlapping year buckets.
export type Era =
  | 'pre2000' | '2000_2005' | '2006_2010' | '2011_2015'
  | '2016_2020' | '2021_2023' | '2024_2026'

export type ContentType = 'movie' | 'tv'
export type MinRating = 6 | 7 | 8 | 9
export type Partner = 'a' | 'b'

// Cards dealt per round. The stored pool holds enough for every round, so a
// later round is a slice of what we already fetched rather than a new request.
export const DECK_SIZE = 30
export const MAX_ROUNDS = 2
export const MIN_ROUND_DECK = 5

export const ERA_BOUNDS: Record<Era, { from: number; to: number }> = {
  pre2000:   { from: 0,    to: 1999 },
  '2000_2005': { from: 2000, to: 2005 },
  '2006_2010': { from: 2006, to: 2010 },
  '2011_2015': { from: 2011, to: 2015 },
  '2016_2020': { from: 2016, to: 2020 },
  '2021_2023': { from: 2021, to: 2023 },
  '2024_2026': { from: 2024, to: 2026 },
}

export interface Preferences {
  genres: Genre[]         // empty = any
  moodText: string
  languages: Language[]   // empty = any
  industries: Industry[]  // empty = any
  contentTypes: ContentType[]   // at least one
  minRating: MinRating
  eras: Era[]             // empty = any
}

export interface Title {
  tmdbId: number
  type: 'movie' | 'tv'
  title: string
  year: number
  imdbRating: number
  runtime: number | null
  synopsis: string
  posterPath: string
  backdropPath: string | null
  genres: string[]
}

export interface OTTPlatform {
  service: string
  serviceName: string
  streamingType: string
  link: string
  logo: string
}

export type SessionStatus =
  | 'waiting_b'
  | 'a_submitted'
  | 'generating'
  | 'swiping'
  | 'matched'
  | 'round2'
  | 'top5'

export interface Session {
  id: string
  status: SessionStatus
  partnerAPreferences: Preferences | null
  partnerBPreferences: Preferences | null
  poolA: Title[]
  poolB: Title[]
  seenTmdbIds: number[]
  round: number
  matchedTmdbId: number | null
  matchedType: 'movie' | 'tv' | null
  createdAt: string
  updatedAt: string
}

// DB row shape (snake_case from Supabase)
export interface SessionRow {
  id: string
  status: SessionStatus
  partner_a_preferences: Preferences | null
  partner_b_preferences: Preferences | null
  pool_a: Title[]
  pool_b: Title[]
  seen_tmdb_ids: number[]
  round: number
  matched_tmdb_id: number | null
  matched_type: 'movie' | 'tv' | null
  created_at: string
  updated_at: string
}

export function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    status: row.status,
    partnerAPreferences: row.partner_a_preferences,
    partnerBPreferences: row.partner_b_preferences,
    poolA: row.pool_a ?? [],
    poolB: row.pool_b ?? [],
    seenTmdbIds: row.seen_tmdb_ids ?? [],
    round: row.round ?? 1,
    matchedTmdbId: row.matched_tmdb_id,
    matchedType: row.matched_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
