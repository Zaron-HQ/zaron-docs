import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' })

const cols = await sql`
  SELECT column_name, udt_name
  FROM information_schema.columns
  WHERE table_name = 'docs_embeddings'
  ORDER BY ordinal_position
`
console.log('docs_embeddings columns:')
for (const c of cols) console.log(`  ${c.column_name}: ${c.udt_name}`)

const migrations = await sql`
  SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5
`
console.log('\nLast 5 migrations (hashes):')
for (const m of migrations) console.log(`  ${m.hash}`)

await sql.end()
