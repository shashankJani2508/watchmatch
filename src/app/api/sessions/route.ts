import { NextResponse } from 'next/server'
import { useSupabase } from '@/lib/db-provider'

// Never cache: these read and write live session state.
export const dynamic = 'force-dynamic'


export async function POST() {
  if (useSupabase()) {
    const { createServerClient } = await import('@/lib/supabase-server')
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('sessions')
      .insert({ status: 'waiting_b' })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ sessionId: data.id })
  }

  const { store } = await import('@/lib/store')
  const session = await store.createSession()
  return NextResponse.json({ sessionId: session.id })
}
