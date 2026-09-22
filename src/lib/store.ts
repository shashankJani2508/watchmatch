import { Title, Preferences, SessionStatus } from '@/types'
import { randomUUID } from 'crypto'
import { neon, NeonQueryFunction } from '@neondatabase/serverless'

export interface StoredSession {
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

export interface StoredSwipe {
  id: string
  session_id: string
  partner: 'a' | 'b'
  tmdb_id: number
  title_type: 'movie' | 'tv'
  liked: boolean
  round: number
}

// In-memory fallback (local dev — pinned to globalThis to survive Next.js HMR re-imports)
const g = globalThis as typeof globalThis & {
  _wmSessions?: Map<string, StoredSession>
  _wmSwipes?: StoredSwipe[]
  _wmSchemaInit?: boolean
  _wmSql?: NeonQueryFunction<false, true>
}
const memSessions: Map<string, StoredSession> =
  g._wmSessions ?? (g._wmSessions = new Map())
const memSwipes: StoredSwipe[] =
  g._wmSwipes ?? (g._wmSwipes = [])

function now() { return new Date().toISOString() }
const hasPostgres = () =>
  !!(process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL)

// Use non-pooling URL to bypass PgBouncer — critical for reliable JSONB writes
function getSql(): NeonQueryFunction<false, true> {
  if (g._wmSql) return g._wmSql
  const connStr = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL
  if (!connStr) throw new Error('No Postgres connection string')
  g._wmSql = neon(connStr, { fullResults: true })
  return g._wmSql
}

async function ensureSchema() {
  if (g._wmSchemaInit) return
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS wm_sessions (
      id UUID PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS wm_swipes (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL,
      partner CHAR(1) NOT NULL,
      tmdb_id INTEGER NOT NULL,
      title_type VARCHAR(10) NOT NULL,
      liked BOOLEAN NOT NULL,
      round INTEGER NOT NULL,
      UNIQUE (session_id, partner, tmdb_id, title_type, round)
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS idx_wm_swipes_session ON wm_swipes(session_id)
  `
  g._wmSchemaInit = true
}

export const store = {
  async createSession(): Promise<StoredSession> {
    const id = randomUUID()
    const session: StoredSession = {
      id, status: 'waiting_b',
      partner_a_preferences: null, partner_b_preferences: null,
      pool_a: [], pool_b: [], seen_tmdb_ids: [],
      round: 1, matched_tmdb_id: null, matched_type: null,
      created_at: now(), updated_at: now(),
    }
    if (hasPostgres()) {
      await ensureSchema()
      const sql = getSql()
      await sql`
        INSERT INTO wm_sessions (id, data, updated_at)
        VALUES (${id}::uuid, ${JSON.stringify(session)}::jsonb, now())
      `
    } else {
      memSessions.set(id, session)
    }
    return session
  },

  async getSession(id: string): Promise<StoredSession | null> {
    if (hasPostgres()) {
      const sql = getSql()
      const result = await sql`SELECT data FROM wm_sessions WHERE id = ${id}::uuid`
      if (result.rows.length === 0) return null
      return result.rows[0].data as StoredSession
    }
    return memSessions.get(id) ?? null
  },

  async updateSession(id: string, patch: Partial<StoredSession>): Promise<StoredSession | null> {
    if (hasPostgres()) {
      const sql = getSql()
      const selectResult = await sql`SELECT data FROM wm_sessions WHERE id = ${id}::uuid`
      if (selectResult.rows.length === 0) return null
      const current = selectResult.rows[0].data as StoredSession
      const updated = { ...current, ...patch, updated_at: now() }
      const updateResult = await sql`
        UPDATE wm_sessions
        SET data = ${JSON.stringify(updated)}::jsonb, updated_at = now()
        WHERE id = ${id}::uuid
      `
      if (updateResult.rowCount === 0) {
        console.error('[store] UPDATE affected 0 rows for session', id)
      }
      return updated
    }
    const s = memSessions.get(id)
    if (!s) return null
    const updated = { ...s, ...patch, updated_at: now() }
    memSessions.set(id, updated)
    return updated
  },

  async addSwipe(swipe: Omit<StoredSwipe, 'id'>): Promise<StoredSwipe> {
    const s = { ...swipe, id: randomUUID() }
    if (hasPostgres()) {
      const sql = getSql()
      await sql`
        INSERT INTO wm_swipes (id, session_id, partner, tmdb_id, title_type, liked, round)
        VALUES (${s.id}::uuid, ${s.session_id}::uuid, ${s.partner}, ${s.tmdb_id}, ${s.title_type}, ${s.liked}, ${s.round})
        ON CONFLICT (session_id, partner, tmdb_id, title_type, round) DO UPDATE
          SET liked = EXCLUDED.liked, id = EXCLUDED.id
      `
    } else {
      memSwipes.push(s)
    }
    return s
  },

  async getSwipes(sessionId: string, round?: number): Promise<StoredSwipe[]> {
    if (hasPostgres()) {
      const sql = getSql()
      const result = round !== undefined
        ? await sql`SELECT * FROM wm_swipes WHERE session_id = ${sessionId}::uuid AND round = ${round}`
        : await sql`SELECT * FROM wm_swipes WHERE session_id = ${sessionId}::uuid`
      return result.rows as StoredSwipe[]
    }
    return memSwipes.filter(
      s => s.session_id === sessionId && (round === undefined || s.round === round)
    )
  },

  async countSwipes(sessionId: string, partner: 'a' | 'b', round: number): Promise<number> {
    if (hasPostgres()) {
      const sql = getSql()
      const result = await sql`
        SELECT COUNT(*)::int AS count FROM wm_swipes
        WHERE session_id = ${sessionId}::uuid AND partner = ${partner} AND round = ${round}
      `
      return result.rows[0].count as number
    }
    return memSwipes.filter(
      s => s.session_id === sessionId && s.partner === partner && s.round === round
    ).length
  },

  async findMatchingSwipe(
    sessionId: string, tmdbId: number, type: 'movie' | 'tv', partner: 'a' | 'b'
  ): Promise<StoredSwipe | null> {
    if (hasPostgres()) {
      const sql = getSql()
      const result = await sql`
        SELECT * FROM wm_swipes
        WHERE session_id = ${sessionId}::uuid AND tmdb_id = ${tmdbId}
          AND title_type = ${type} AND partner = ${partner} AND liked = true
        LIMIT 1
      `
      return result.rows.length > 0 ? result.rows[0] as StoredSwipe : null
    }
    return memSwipes.find(s =>
      s.session_id === sessionId && s.tmdb_id === tmdbId &&
      s.title_type === type && s.partner === partner && s.liked
    ) ?? null
  },
}
