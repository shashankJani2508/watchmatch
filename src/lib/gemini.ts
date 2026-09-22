import { Preferences } from '../types'

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

const GENRE_MAP: Record<string, number> = {
  action: 28, adventure: 12, animation: 16, comedy: 35,
  crime: 80, documentary: 99, drama: 18, family: 10751,
  fantasy: 14, history: 36, horror: 27, music: 10402,
  mystery: 9648, romance: 10749, 'sci-fi': 878, thriller: 53,
  war: 10752, western: 37,
}

export interface SearchBrief {
  genres: number[]
  sortBy: string
  notes: string
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in Gemini response')
  return JSON.parse(match[0])
}

async function askGemini(prompt: string, maxOutputTokens: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set')

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens, responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty Gemini response')
  return text
}

export async function generateSearchBrief(
  prefA: Preferences,
  prefB: Preferences
): Promise<SearchBrief> {
  const prompt = `Two people want to watch something together tonight. Find their common ground.

Partner A — genres: ${prefA.genres.join(', ') || 'no preference'}${prefA.moodText ? `; in their words: "${prefA.moodText}"` : ''}; min rating: ${prefA.minRating}+

Partner B — genres: ${prefB.genres.join(', ') || 'no preference'}${prefB.moodText ? `; in their words: "${prefB.moodText}"` : ''}; min rating: ${prefB.minRating}+

Based on both profiles, pick TMDB genre IDs that would satisfy BOTH people. Prioritise genres at the intersection of their tastes. If their moods seem incompatible, find a genre that bridges them (e.g. romantic + intense → romantic drama or crime romance).

Respond ONLY with this JSON (no commentary):
{
  "genres": [list of up to 5 TMDB genre IDs],
  "sortBy": "vote_average.desc",
  "notes": "one sentence on why these genres work for both"
}

TMDB genre IDs available: ${JSON.stringify(GENRE_MAP)}`

  const parsed = extractJson(await askGemini(prompt, 2000)) as SearchBrief
  return {
    genres: Array.isArray(parsed.genres) ? parsed.genres : [],
    sortBy: typeof parsed.sortBy === 'string' ? parsed.sortBy : 'vote_average.desc',
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  }
}

export async function generateRound2Brief(
  prefA: Preferences,
  prefB: Preferences,
  aLikedCount: number,
  bLikedCount: number,
  overlapCount: number
): Promise<{ genres: number[]; sortBy: string }> {
  const prompt = `Round 1 swiping ended with no match. Here's what happened:
- Partner A liked ${aLikedCount} titles (Partner B passed on them)
- Partner B liked ${bLikedCount} titles (Partner A passed on them)
- Both liked the same title ${overlapCount} time(s) but this wasn't detected as a match (edge case)

Partner A genres: ${prefA.genres.join(', ') || 'any'} — "${prefA.moodText || ''}"
Partner B genres: ${prefB.genres.join(', ') || 'any'} — "${prefB.moodText || ''}"

For round 2, suggest different TMDB genres that might better bridge their tastes. Try a different angle from round 1.

Respond ONLY with JSON:
{ "genres": [up to 5 TMDB genre IDs], "sortBy": "popularity.desc" }

TMDB genre IDs: ${JSON.stringify(GENRE_MAP)}`

  try {
    const parsed = extractJson(await askGemini(prompt, 1000)) as { genres: number[]; sortBy: string }
    return {
      genres: Array.isArray(parsed.genres) ? parsed.genres : [],
      sortBy: typeof parsed.sortBy === 'string' ? parsed.sortBy : 'popularity.desc',
    }
  } catch {
    return { genres: [18, 35, 28], sortBy: 'popularity.desc' }
  }
}
