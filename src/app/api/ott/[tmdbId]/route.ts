import { NextRequest, NextResponse } from 'next/server'
import { getOTTAvailability } from '@/lib/ott'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { tmdbId: string } }
) {
  const type = (req.nextUrl.searchParams.get('type') ?? 'movie') as 'movie' | 'tv'
  const tmdbId = parseInt(params.tmdbId)

  if (isNaN(tmdbId)) {
    return NextResponse.json({ error: 'Invalid tmdbId' }, { status: 400 })
  }

  const platforms = await getOTTAvailability(tmdbId, type)
  return NextResponse.json({ platforms })
}
