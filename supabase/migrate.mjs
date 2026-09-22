/**
 * Pushes supabase/schema.sql to the remote Supabase project.
 * Uses the Supabase Management API (api.supabase.com).
 *
 * Usage: node supabase/migrate.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))

// Load .env.local manually (we're running outside Next.js)
const envPath = join(__dir, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf8')
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const PROJECT_REF = 'bnlhnjvjmcdabjoseobt'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const SQL          = readFileSync(join(__dir, 'schema.sql'), 'utf8')

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set in .env.local')
  process.exit(1)
}

// Split the SQL into individual statements so we can run them via RPC
const statements = SQL
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

console.log(`Pushing schema to Supabase project: ${PROJECT_REF}`)
console.log(`Statements to execute: ${statements.length}`)

async function runSQL(sql) {
  // Try Supabase Management API first
  const mgmtRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  )

  if (mgmtRes.ok) {
    return { ok: true, via: 'management-api' }
  }

  const errText = await mgmtRes.text()
  return { ok: false, status: mgmtRes.status, error: errText, via: 'management-api' }
}

// Run the full schema as one batch
const result = await runSQL(SQL)

if (result.ok) {
  console.log(`✓ Schema pushed successfully via ${result.via}`)
} else {
  console.error(`✗ Management API failed (${result.status}): ${result.error}`)
  console.log('\nTrying statement-by-statement via Supabase REST...')

  // Fallback: try each statement via supabase rpc (needs exec_sql function to exist)
  let succeeded = 0
  for (const stmt of statements) {
    const res = await fetch(
      `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql_query: stmt }),
      }
    )
    if (res.ok) {
      succeeded++
    } else {
      const err = await res.text()
      console.log(`  Stmt skipped (${res.status}): ${stmt.slice(0, 60)}... → ${err.slice(0, 100)}`)
    }
  }

  if (succeeded > 0) {
    console.log(`✓ Ran ${succeeded}/${statements.length} statements via RPC`)
  } else {
    console.log('\n──────────────────────────────────────────────────────────')
    console.log('Automatic migration failed. Please run schema.sql manually:')
    console.log('  1. Open https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new')
    console.log('  2. Paste the contents of supabase/schema.sql')
    console.log('  3. Click "Run"')
    console.log('──────────────────────────────────────────────────────────')
    process.exit(1)
  }
}
