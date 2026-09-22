import { OTTPlatform } from '../types'

const IMG = 'https://image.tmdb.org/t/p/w92'

// TMDB groups providers by how you get access. Order matters: a subscription
// the viewer may already have is more useful than a paid rental.
const BUCKETS: Array<{ key: string; label: OTTPlatform['streamingType'] }> = [
  { key: 'flatrate', label: 'subscription' },
  { key: 'free', label: 'free' },
  { key: 'ads', label: 'ads' },
  { key: 'rent', label: 'rent' },
  { key: 'buy', label: 'buy' },
]

interface TmdbProvider {
  provider_id: number
  provider_name: string
  logo_path?: string
}

export async function getOTTAvailability(
  tmdbId: number,
  type: 'movie' | 'tv',
  region = 'IN'
): Promise<OTTPlatform[]> {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN
  if (!token) return []

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/watch/providers`,
      { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
        next: { revalidate: 86400 } }
    )
    if (!res.ok) return []

    const data = await res.json()
    const forRegion = data?.results?.[region]
    if (!forRegion) return []

    const link: string = forRegion.link ?? '#'
    const out: OTTPlatform[] = []
    const seen = new Set<number>()

    for (const { key, label } of BUCKETS) {
      for (const p of (forRegion[key] ?? []) as TmdbProvider[]) {
        if (seen.has(p.provider_id)) continue
        seen.add(p.provider_id)
        out.push({
          service: String(p.provider_id),
          serviceName: p.provider_name,
          streamingType: label,
          link,
          logo: p.logo_path ? `${IMG}${p.logo_path}` : '',
        })
      }
    }
    return out
  } catch (e) {
    console.error('OTT fetch error:', e)
    return []
  }
}
