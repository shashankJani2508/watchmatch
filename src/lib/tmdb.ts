import { Preferences, Title, Genre, Era, DECK_SIZE, MAX_ROUNDS, ERA_BOUNDS } from '../types'
import { SearchBrief } from './gemini'

const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p/w500'

const LANG_CODES: Record<string, string> = {
  hindi: 'hi', english: 'en', tamil: 'ta', telugu: 'te', kannada: 'kn',
  gujarati: 'gu', korean: 'ko', french: 'fr',
}

// Production origin, independent of the spoken language.
const INDUSTRY_COUNTRIES: Record<string, string> = {
  hollywood: 'US', bollywood: 'IN', turkish: 'TR', korean: 'KR', chinese: 'CN',
}

// One TMDB genre id per category, so the choices stay mutually exclusive.
export const GENRE_IDS: Record<Genre, number> = {
  action: 28, adventure: 12, comedy: 35, drama: 18,
  romance: 10749, thriller: 53, horror: 27, mystery: 9648,
  crime: 80, scifi: 878, fantasy: 14, historical: 36,
}

// Series have no Romance, Thriller, Horror or History genre on TMDB. null means
// "can't express this for series" — we skip the series query for that genre
// rather than substituting something the user didn't ask for.
const GENRE_IDS_TV: Record<Genre, number | null> = {
  action: 10759, adventure: 10759, comedy: 35, drama: 18,
  romance: null, thriller: null, horror: null, mystery: 9648,
  crime: 80, scifi: 10765, fantasy: 10765, historical: null,
}

// For the four genres TMDB doesn't define for series, its keyword index does
// the job — with_keywords=315058 returns Stranger Things, Death Note and so on.
const GENRE_KEYWORDS_TV: Partial<Record<Genre, number>> = {
  horror: 315058, romance: 9840, thriller: 316362, historical: 15126,
}

// TMDB ANDs with_genres and with_keywords, so the two can't be OR-ed in one
// request — they go out as separate queries and the results are merged.
function genreSelectors(
  type: 'movie' | 'tv',
  genres: Genre[],
  briefGenres: number[]
): Array<Record<string, string>> {
  if (genres.length === 0) {
    // Only the model's guess is available, and its ids are movie ids.
    if (type === 'tv' || briefGenres.length === 0) return [{}]
    return [{ with_genres: briefGenres.join('|') }]
  }

  if (type === 'movie') {
    const ids = [...new Set(genres.map(g => GENRE_IDS[g]))]
    return [{ with_genres: ids.join('|') }]
  }

  const ids = [...new Set(
    genres.map(g => GENRE_IDS_TV[g]).filter((v): v is number => typeof v === 'number')
  )]
  const keywords = [...new Set(
    genres.map(g => GENRE_KEYWORDS_TV[g]).filter((v): v is number => typeof v === 'number')
  )]

  const selectors: Array<Record<string, string>> = []
  if (ids.length > 0) selectors.push({ with_genres: ids.join('|') })
  if (keywords.length > 0) selectors.push({ with_keywords: keywords.join('|') })
  return selectors
}

const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller',
  10752: 'War', 37: 'Western',
}

// TMDB uses a separate, coarser genre set for series.
const GENRE_NAMES_TV: Record<number, string> = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids',
  9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy',
  10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western',
}

async function tmdbFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.TMDB_API_READ_ACCESS_TOKEN}`,
      accept: 'application/json',
    },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`)
  return res.json()
}

type DateRange = Record<string, string>

// One TMDB query expresses a single date window, so each chosen era gets its
// own query and the results are merged. Folding them into one range would make
// an impossible window (e.g. pre-2000 + 2024-2026 => after 2024 and before 1999).
function eraRanges(eras: Era[], type: 'movie' | 'tv'): DateRange[] {
  if (!eras || eras.length === 0) return [{}]
  const df = type === 'movie' ? 'primary_release_date' : 'first_air_date'
  return eras.map(e => {
    const b = ERA_BOUNDS[e]
    if (!b) return {}
    const range: DateRange = {}
    if (b.from > 0) range[`${df}.gte`] = `${b.from}-01-01`
    range[`${df}.lte`] = `${b.to}-12-31`
    return range
  })
}

function yearAllowed(year: number, eras: Era[]): boolean {
  if (!eras || eras.length === 0) return true
  return eras.some(e => {
    const b = ERA_BOUNDS[e]
    return b ? year >= b.from && year <= b.to : true
  })
}

function mapTitle(type: 'movie' | 'tv', item: Record<string, any>): Title {
  return {
    tmdbId: item.id,
    type,
    title: item.title ?? item.name ?? 'Unknown',
    year: parseInt((item.release_date ?? item.first_air_date ?? '2000').slice(0, 4)),
    imdbRating: Math.round(item.vote_average * 10) / 10,
    runtime: item.runtime ?? item.episode_run_time?.[0] ?? null,
    synopsis: item.overview?.slice(0, 180) ?? '',
    posterPath: `${IMG}${item.poster_path}`,
    backdropPath: item.backdrop_path ? `${IMG}${item.backdrop_path}` : null,
    genres: (item.genre_ids ?? [])
      .map((id: number) => (type === 'tv' ? GENRE_NAMES_TV[id] : GENRE_NAMES[id]))
      .filter(Boolean),
  }
}

async function discover(type: 'movie' | 'tv', params: Record<string, string>, pages = 3): Promise<Title[]> {
  const perPage = await Promise.all(
    Array.from({ length: pages }, (_, i) => i + 1).map(async page => {
      const qs = new URLSearchParams({ ...params, page: String(page) }).toString()
      try {
        const data = await tmdbFetch(`/discover/${type}?${qs}`)
        return (data.results ?? [])
          .filter((item: Record<string, any>) => item.poster_path)
          .map((item: Record<string, any>) => mapTitle(type, item))
      } catch (e) {
        console.error(`discover ${type} page ${page}:`, e)
        return [] as Title[]
      }
    })
  )
  return perPage.flat()
}

// A narrow filter combination (high rating + one language + one era + genres)
// can return almost nothing from TMDB. A 1-title deck ends the round after a
// single swipe, so widen the search until there is enough to actually swipe on.
const TARGET_POOL = DECK_SIZE * MAX_ROUNDS

// Two partners' picks: use what they agree on, and fall back to the union so a
// disagreement widens the search instead of emptying it.
function combine<T>(a: T[], b: T[]): T[] {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const shared = a.filter(x => b.includes(x))
  return shared.length > 0 ? shared : [...new Set([...a, ...b])]
}

export function agreedFilters(prefA: Preferences, prefB: Preferences) {
  return {
    minRating: Math.max(prefA.minRating, prefB.minRating),
    languages: combine(prefA.languages, prefB.languages),
    industries: combine(prefA.industries, prefB.industries),
    genres: combine(prefA.genres, prefB.genres),
    // Eras union: each partner's chosen windows all stay available.
    eras: [...new Set([...prefA.eras, ...prefB.eras])] as Era[],
    contentTypes: combine(prefA.contentTypes ?? ['movie'], prefB.contentTypes ?? ['movie']),
  }
}

export async function fetchTitlePool(
  prefA: Preferences,
  prefB: Preferences,
  brief: SearchBrief,
  seenIds: number[],
  round = 1
): Promise<{ poolA: Title[]; poolB: Title[] }> {
  // Everything here is the users' explicit choice and is never traded away to
  // fill the deck — a smaller deck beats one that ignores what they asked for.
  const f = agreedFilters(prefA, prefB)
  const types: Array<'movie' | 'tv'> =
    f.contentTypes.length > 0 ? (f.contentTypes as Array<'movie' | 'tv'>) : ['movie']

  const genreIsUserChoice = f.genres.length > 0

  const langCodes = f.languages.map(l => LANG_CODES[l]).filter(Boolean)
  const countryCodes = f.industries.map(i => INDUSTRY_COUNTRIES[i]).filter(Boolean)

  // Only our own heuristics loosen: a model-suggested genre, our popularity
  // floor, and paging depth. Era, language, industry and rating never move.
  const attempts = [
    { useGenres: true, voteCount: '150', pages: round === 1 ? 3 : 2 },
    { useGenres: genreIsUserChoice, voteCount: '100', pages: round === 1 ? 3 : 2 },
    { useGenres: genreIsUserChoice, voteCount: '20', pages: 5 },
  ]

  const seen = new Set(seenIds)
  const uniqMap = new Map<number, Title>()

  // An empty list means "no restriction on this axis", so a single blank entry
  // keeps the loop shape the same either way.
  const langSlots = langCodes.length > 0 ? langCodes.slice(0, 8) : ['']
  const countrySlots = countryCodes.length > 0 ? countryCodes.slice(0, 5) : ['']

  for (const attempt of attempts) {
    const queries: Promise<Title[]>[] = []
    for (const lang of langSlots) {
      for (const country of countrySlots) {
        for (const type of types) {
          const selectors = attempt.useGenres
            ? genreSelectors(type, f.genres, brief.genres)
            : [{}]
          for (const selector of selectors) {
            for (const range of eraRanges(f.eras, type)) {
              const params: Record<string, string> = {
                'vote_average.gte': String(f.minRating),
                'vote_count.gte': attempt.voteCount,
                sort_by: brief.sortBy,
                ...range,
                ...selector,
              }
              if (lang) params.with_original_language = lang
              if (country) params.with_origin_country = country
              queries.push(discover(type, params, attempt.pages))
            }
          }
        }
      }
    }

    for (const t of (await Promise.all(queries)).flat()) {
      if (seen.has(t.tmdbId) || uniqMap.has(t.tmdbId)) continue
      // Re-check locally: TMDB's date filter keys off region-specific release
      // data and occasionally lets through a title the user excluded.
      if (t.imdbRating < f.minRating) continue
      if (!yearAllowed(t.year, f.eras)) continue
      if (!types.includes(t.type)) continue
      uniqMap.set(t.tmdbId, t)
    }
    if (uniqMap.size >= TARGET_POOL) break
  }

  const pool = Array.from(uniqMap.values())

  // Two independent shuffles for A and B
  const shuffleA = [...pool].sort(() => Math.random() - 0.5).slice(0, TARGET_POOL)
  const shuffleB = [...pool].sort(() => Math.random() - 0.5).slice(0, TARGET_POOL)

  return { poolA: shuffleA, poolB: shuffleB }
}

const DEMO_TITLES: Title[] = [
  { tmdbId: 238,   type: 'movie', title: 'The Godfather',          year: 1972, imdbRating: 9.2, runtime: 175, synopsis: 'The aging patriarch of an organized crime dynasty transfers control to his reluctant son.', posterPath: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsLWxrzHEzfnb.jpg', backdropPath: null, genres: ['Drama', 'Crime'] },
  { tmdbId: 278,   type: 'movie', title: 'The Shawshank Redemption', year: 1994, imdbRating: 9.3, runtime: 142, synopsis: 'Two imprisoned men bond over a number of years, finding solace and eventual redemption.', posterPath: 'https://image.tmdb.org/t/p/w500/lyQBXzOQSuE59IsHyhrp0qIiPAz.jpg', backdropPath: null, genres: ['Drama'] },
  { tmdbId: 240,   type: 'movie', title: 'The Godfather Part II',   year: 1974, imdbRating: 9.0, runtime: 202, synopsis: 'The rise of Michael Corleone continues alongside the early life of his father Vito.', posterPath: 'https://image.tmdb.org/t/p/w500/hek3koDUyRQk7FIhPXsa6mT2Zc3.jpg', backdropPath: null, genres: ['Drama', 'Crime'] },
  { tmdbId: 424,   type: 'movie', title: "Schindler's List",        year: 1993, imdbRating: 9.0, runtime: 195, synopsis: 'In German-occupied Poland, industrialist Oskar Schindler saves thousands of Jewish lives.', posterPath: 'https://image.tmdb.org/t/p/w500/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg', backdropPath: null, genres: ['Drama', 'History', 'War'] },
  { tmdbId: 637,   type: 'movie', title: 'Life Is Beautiful',       year: 1997, imdbRating: 8.6, runtime: 116, synopsis: 'A Jewish man uses humour and imagination to shield his son from the horrors of a Nazi camp.', posterPath: 'https://image.tmdb.org/t/p/w500/74hLDKjD5aGYOotO6esUVaeISa2.jpg', backdropPath: null, genres: ['Comedy', 'Drama', 'Romance'] },
  { tmdbId: 155,   type: 'movie', title: 'The Dark Knight',         year: 2008, imdbRating: 9.0, runtime: 152, synopsis: 'When the Joker wreaks havoc on Gotham, Batman must accept one of the greatest tests.', posterPath: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg', backdropPath: null, genres: ['Action', 'Crime', 'Drama', 'Thriller'] },
  { tmdbId: 680,   type: 'movie', title: 'Pulp Fiction',            year: 1994, imdbRating: 8.9, runtime: 154, synopsis: 'The lives of two mob hitmen, a boxer, a gangster and his wife intertwine in four tales.', posterPath: 'https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', backdropPath: null, genres: ['Crime', 'Thriller'] },
  { tmdbId: 13,    type: 'movie', title: 'Forrest Gump',            year: 1994, imdbRating: 8.8, runtime: 142, synopsis: 'A man with low IQ has accidentally been present at many historic moments in American history.', posterPath: 'https://image.tmdb.org/t/p/w500/saHP97rTPS5eLmrLQEcANmKrsFl.jpg', backdropPath: null, genres: ['Comedy', 'Drama', 'Romance'] },
  { tmdbId: 9806,  type: 'movie', title: 'The Incredibles',         year: 2004, imdbRating: 8.0, runtime: 115, synopsis: 'A family of undercover superheroes struggle to live the quiet suburban life while a new villain emerges.', posterPath: 'https://image.tmdb.org/t/p/w500/2LqaLgk4Z226KkgPJuiOQ58ShKD.jpg', backdropPath: null, genres: ['Action', 'Adventure', 'Animation', 'Family'] },
  { tmdbId: 497,   type: 'movie', title: 'The Green Mile',          year: 1999, imdbRating: 8.6, runtime: 189, synopsis: 'A death row corrections officer discovers one of his prisoners has a supernatural gift.', posterPath: 'https://image.tmdb.org/t/p/w500/velWPhVMQeQKcxggNEU8YmU1VUd.jpg', backdropPath: null, genres: ['Fantasy', 'Drama', 'Crime'] },
  { tmdbId: 129,   type: 'movie', title: "Spirited Away",           year: 2001, imdbRating: 8.6, runtime: 125, synopsis: "During her family's move, a sullen girl wanders into a world ruled by gods, witches, and spirits.", posterPath: 'https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', backdropPath: null, genres: ['Animation', 'Family', 'Fantasy'] },
  { tmdbId: 372058, type: 'movie', title: 'Your Name',              year: 2016, imdbRating: 8.4, runtime: 106, synopsis: "Two strangers find themselves linked in a bizarre way, affecting each other's lives.", posterPath: 'https://image.tmdb.org/t/p/w500/q719jXXEzOoYaps6babgKnONONX.jpg', backdropPath: null, genres: ['Romance', 'Animation', 'Drama'] },
  { tmdbId: 19404, type: 'movie', title: 'Dilwale Dulhania Le Jayenge', year: 1995, imdbRating: 8.1, runtime: 189, synopsis: 'A young man and a woman fall in love on a trip to Europe, but their families have other plans.', posterPath: 'https://image.tmdb.org/t/p/w500/lfRkUr7DYdHldAqi3PwdQABBnHq.jpg', backdropPath: null, genres: ['Drama', 'Romance'] },
  { tmdbId: 161434, type: 'movie', title: 'Dangal',                 year: 2016, imdbRating: 8.3, runtime: 161, synopsis: 'A former wrestler trains his daughters to become world-class wrestlers.', posterPath: 'https://image.tmdb.org/t/p/w500/t4vEn3TuS7AaWP2j8krTLAZWLOL.jpg', backdropPath: null, genres: ['Action', 'Biography', 'Drama', 'Sport'] },
  { tmdbId: 281338, type: 'movie', title: 'War for the Planet of the Apes', year: 2017, imdbRating: 7.4, runtime: 140, synopsis: 'Caesar and his apes are forced into a deadly conflict with an army of humans.', posterPath: 'https://image.tmdb.org/t/p/w500/ngBFDOsx4YCZJW33x184YDXNLGM.jpg', backdropPath: null, genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'] },
  { tmdbId: 510,   type: 'movie', title: 'One Flew Over the Cuckoo\'s Nest', year: 1975, imdbRating: 8.7, runtime: 133, synopsis: 'A criminal pleads insanity and is admitted to a mental institution, battling the oppressive head nurse.', posterPath: 'https://image.tmdb.org/t/p/w500/3jcbDmRFiQ83drpoMfXHCmL43Xk.jpg', backdropPath: null, genres: ['Drama'] },
  { tmdbId: 389,   type: 'movie', title: '12 Angry Men',            year: 1957, imdbRating: 9.0, runtime: 96,  synopsis: 'A jury holdout attempts to prevent a miscarriage of justice by forcing his colleagues to reconsider the evidence.', posterPath: 'https://image.tmdb.org/t/p/w500/ppd84D2i9W8jXmsyInGyihiSyqz.jpg', backdropPath: null, genres: ['Drama'] },
  { tmdbId: 311,   type: 'movie', title: 'Once Upon a Time in the West', year: 1968, imdbRating: 8.5, runtime: 165, synopsis: 'A mysterious stranger with a harmonica joins forces with a notorious desperado.', posterPath: 'https://image.tmdb.org/t/p/w500/qbYgqOczabWZkBSjXBCaWKFxHqj.jpg', backdropPath: null, genres: ['Western'] },
  { tmdbId: 539,   type: 'movie', title: 'Psycho',                  year: 1960, imdbRating: 8.5, runtime: 109, synopsis: 'A secretary encounters a young motel proprietor, too dominated by his mother.', posterPath: 'https://image.tmdb.org/t/p/w500/yz4QVqPx3h8hD4QqR4ZJpdsT9PR.jpg', backdropPath: null, genres: ['Horror', 'Mystery', 'Thriller'] },
  { tmdbId: 769,   type: 'movie', title: 'GoodFellas',              year: 1990, imdbRating: 8.7, runtime: 146, synopsis: 'The story of Henry Hill and his life in the mob, covering his relationship with his wife and associates.', posterPath: 'https://image.tmdb.org/t/p/w500/aKuFiU82s5ISJpGZp7YkIr3kCUd.jpg', backdropPath: null, genres: ['Drama', 'Crime'] },
  { tmdbId: 346364, type: 'movie', title: 'It',                    year: 2017, imdbRating: 7.3, runtime: 135, synopsis: 'Seven young outcasts face their deepest fears when they square off against a terrifying creature.', posterPath: 'https://image.tmdb.org/t/p/w500/9E2y5Q7WlCVHeFtXKLF3wUZDrAD.jpg', backdropPath: null, genres: ['Horror'] },
  { tmdbId: 299536, type: 'movie', title: 'Avengers: Infinity War', year: 2018, imdbRating: 8.4, runtime: 149, synopsis: 'The Avengers and their allies must be willing to sacrifice all in order to defeat the powerful Thanos.', posterPath: 'https://image.tmdb.org/t/p/w500/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg', backdropPath: null, genres: ['Action', 'Adventure', 'Sci-Fi'] },
  { tmdbId: 299534, type: 'movie', title: 'Avengers: Endgame',     year: 2019, imdbRating: 8.4, runtime: 181, synopsis: 'After the devastating events of Infinity War, the universe is in ruins. The Avengers assemble once more.', posterPath: 'https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg', backdropPath: null, genres: ['Action', 'Adventure', 'Sci-Fi'] },
  { tmdbId: 244786, type: 'movie', title: 'Whiplash',              year: 2014, imdbRating: 8.5, runtime: 106, synopsis: 'A promising young drummer enrolls at a cut-throat music conservatory where his teacher pushes him to the brink.', posterPath: 'https://image.tmdb.org/t/p/w500/7fn624j5lj3xTme2SgiLCeuedmO.jpg', backdropPath: null, genres: ['Drama', 'Music'] },
  { tmdbId: 598,   type: 'movie', title: 'City of God',            year: 2002, imdbRating: 8.6, runtime: 130, synopsis: 'In the slums of Rio de Janeiro, the lives of a photographer and a drug lord intertwine.', posterPath: 'https://image.tmdb.org/t/p/w500/k7eYdWvhYQyRQoU2TB2A2Xu2grZ.jpg', backdropPath: null, genres: ['Crime', 'Drama'] },
  { tmdbId: 37165,  type: 'tv',   title: 'The Twilight Zone',      year: 1959, imdbRating: 9.0, runtime: 25,  synopsis: 'Ordinary people find themselves in extraordinary, usually frightening, situations.', posterPath: 'https://image.tmdb.org/t/p/w500/u4DYXPJL0PzXVKYBLfEsVXKRWv3.jpg', backdropPath: null, genres: ['Mystery', 'Sci-Fi', 'Thriller'] },
  { tmdbId: 1396,   type: 'tv',   title: 'Breaking Bad',           year: 2008, imdbRating: 9.5, runtime: 47,  synopsis: 'A high school chemistry teacher turns to manufacturing methamphetamine to secure his family\'s future.', posterPath: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', backdropPath: null, genres: ['Crime', 'Drama', 'Thriller'] },
  { tmdbId: 60625,  type: 'tv',   title: 'Rick and Morty',         year: 2013, imdbRating: 9.1, runtime: 23,  synopsis: 'An animated series following a genius scientist and his not-so-bright grandson on adventures.', posterPath: 'https://image.tmdb.org/t/p/w500/cvhNj9eoRBe5SxjCbQTkh05UP5K.jpg', backdropPath: null, genres: ['Animation', 'Comedy', 'Sci-Fi'] },
  { tmdbId: 66732,  type: 'tv',   title: 'Stranger Things',        year: 2016, imdbRating: 8.7, runtime: 51,  synopsis: 'When a young boy disappears, a small town uncovers a mystery of secret experiments and supernatural forces.', posterPath: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg', backdropPath: null, genres: ['Drama', 'Fantasy', 'Horror', 'Mystery', 'Sci-Fi', 'Thriller'] },
  { tmdbId: 94997,  type: 'tv',   title: 'House of the Dragon',    year: 2022, imdbRating: 8.4, runtime: 60,  synopsis: 'The story of House Targaryen set 200 years before Game of Thrones.', posterPath: 'https://image.tmdb.org/t/p/w500/t9XkeegN9xLvkMFAjJsE9rNs7mq.jpg', backdropPath: null, genres: ['Action', 'Adventure', 'Drama', 'Fantasy'] },
  { tmdbId: 84958,  type: 'tv',   title: 'Loki',                   year: 2021, imdbRating: 8.2, runtime: 48,  synopsis: 'The mercurial villain Loki resumes his role as the God of Mischief in a new series.', posterPath: 'https://image.tmdb.org/t/p/w500/kEl2t3OhXc3Zb9FBh1AuYzRTgZp.jpg', backdropPath: null, genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'] },
]

export function getDemoPool(): { poolA: Title[]; poolB: Title[] } {
  const shuffleA = [...DEMO_TITLES].sort(() => Math.random() - 0.5)
  const shuffleB = [...DEMO_TITLES].sort(() => Math.random() - 0.5)
  return { poolA: shuffleA, poolB: shuffleB }
}

export async function getTitleDetails(tmdbId: number, type: 'movie' | 'tv'): Promise<Title | null> {
  try {
    const d = await tmdbFetch(`/${type}/${tmdbId}`)
    return {
      tmdbId: d.id,
      type,
      title: d.title ?? d.name ?? 'Unknown',
      year: parseInt((d.release_date ?? d.first_air_date ?? '2000').slice(0, 4)),
      imdbRating: Math.round(d.vote_average * 10) / 10,
      runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
      synopsis: d.overview ?? '',
      posterPath: d.poster_path ? `${IMG}${d.poster_path}` : '',
      backdropPath: d.backdrop_path ? `${IMG}${d.backdrop_path}` : null,
      genres: (d.genres ?? []).map((g: { name: string }) => g.name),
    }
  } catch {
    return null
  }
}
