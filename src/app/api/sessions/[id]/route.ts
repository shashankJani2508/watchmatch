import { NextRequest, NextResponse } from 'next/server'
import { rowToSession, SessionRow } from '@/types'
import { useSupabase } from '@/lib/db-provider'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }


export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (useSupabase()) {
    const { createServerClient } = await import('@/lib/supabase-server')
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', params.id)
      .single()
    if (error || !data) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json(rowToSession(data as SessionRow), { headers: NO_STORE })
  }

  const { store } = await import('@/lib/store')
  const session = await store.getSession(params.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json(rowToSession(session as SessionRow), { headers: NO_STORE })
}
