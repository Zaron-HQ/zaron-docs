/**
 * Docs ingest script — populates the docs_embeddings table.
 *
 * Reads all English MDX files, strips MDX syntax to plain text,
 * splits by heading into chunks, embeds via Amazon Bedrock Titan Embed Text V2,
 * and writes into the shared Neon PostgreSQL docs_embeddings table.
 *
 * Usage:
 *   bun run apps/docs/scripts/ingest-docs.ts
 *
 * Required env vars (from apps/docs/.env.local or shell):
 *   DATABASE_URL        — Neon PostgreSQL connection string
 *   AWS_REGION          — e.g. us-east-1
 *   AWS_ACCESS_KEY_ID   — IAM credentials with bedrock:InvokeModel
 *   AWS_SECRET_ACCESS_KEY
 *
 * Options:
 *   --lang <code>   Only ingest a specific locale (default: en)
 *   --dry-run       Parse and chunk without writing to DB
 *   --force         Re-embed all files even if already present in DB
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import postgres from 'postgres'

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = join(__dirname, '..', 'content', 'docs')
const DOCS_BASE_URL = 'https://zaron.dev/docs'

const EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024
const CHUNK_TARGET_CHARS = 1200  // ~300 tokens — good retrieval granularity
const CHUNK_MIN_CHARS = 80       // skip trivially short sections
// Titan V2 max input: 8192 tokens. We batch conservatively.
const BEDROCK_BATCH_DELAY_MS = 50 // small delay between calls to avoid throttling

const args = process.argv.slice(2)
const LANG = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en'
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')

// ── Bedrock client ────────────────────────────────────────────────────────────

function getBedrockClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1'
  // Force HTTP/1.1 — the default HTTP/2 handler causes connection issues in Bun
  const { NodeHttpHandler } = require('@smithy/node-http-handler')
  return new BedrockRuntimeClient({
    region,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 30000,
      requestTimeout: 60000,
    }),
  })
}

/**
 * Generate a single embedding via Bedrock Titan Embed Text V2.
 * Titan V2 supports configurable dimensions (256 / 512 / 1024).
 */
async function embedText(client: BedrockRuntimeClient, text: string): Promise<number[]> {
  const body = JSON.stringify({
    inputText: text,
    dimensions: EMBEDDING_DIMENSIONS,
    normalize: true,
  })

  const command = new InvokeModelCommand({
    modelId: EMBEDDING_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: Buffer.from(body),
  })

  const response = await client.send(command)
  const parsed = JSON.parse(Buffer.from(response.body).toString()) as {
    embedding: number[]
    inputTextTokenCount: number
  }

  return parsed.embedding
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  return postgres(url, { prepare: false, max: 5 })
}

async function getEmbeddedDocuments(
  sql: ReturnType<typeof postgres>
): Promise<Set<string>> {
  const rows = await sql<Array<{ source_document: string }>>`
    SELECT DISTINCT source_document FROM docs_embeddings
  `
  return new Set(rows.map((r) => r.source_document))
}

async function writeChunks(
  sql: ReturnType<typeof postgres>,
  sourceDocument: string,
  rows: Array<{
    chunkText: string
    sourceLink: string
    headerText: string
    headerLevel: number
    tokenCount: number
    embedding: number[]
    metadata: Record<string, unknown>
  }>
): Promise<void> {
  // Delete existing rows for this document, then insert fresh
  await sql`DELETE FROM docs_embeddings WHERE source_document = ${sourceDocument}`

  for (const row of rows) {
    await sql`
      INSERT INTO docs_embeddings
        (chunk_text, source_document, source_link, header_text, header_level,
         token_count, embedding_model, embedding, metadata)
      VALUES (
        ${row.chunkText},
        ${sourceDocument},
        ${row.sourceLink},
        ${row.headerText},
        ${row.headerLevel},
        ${row.tokenCount},
        ${EMBEDDING_MODEL_ID},
        ${`[${row.embedding.join(',')}]`}::vector,
        ${JSON.stringify(row.metadata)}::jsonb
      )
    `
  }
}

// ── MDX → plain text ──────────────────────────────────────────────────────────

function mdxToPlainText(raw: string): string {
  return raw
    // Remove frontmatter
    .replace(/^---[\s\S]*?---\n?/, '')
    // Remove import statements
    .replace(/^import\s+.*$/gm, '')
    // Remove JSX component tags (self-closing)
    .replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, '')
    // Remove JSX component blocks
    .replace(/<[A-Z][A-Za-z]*[^>]*>[\s\S]*?<\/[A-Z][A-Za-z]*>/g, '')
    // Remove remaining HTML tags
    .replace(/<[a-z]+[^>]*>/g, '')
    .replace(/<\/[a-z]+>/g, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Chunking ──────────────────────────────────────────────────────────────────

interface Chunk {
  text: string
  headerText: string
  headerLevel: number
  hash: string
}

function chunkText(text: string, docTitle: string): Chunk[] {
  const chunks: Chunk[] = []
  const sections = text.split(/(?=^#{1,3} )/m).filter((s) => s.trim())

  for (const section of sections) {
    const lines = section.split('\n')
    const firstLine = lines[0].trim()
    const headingMatch = firstLine.match(/^(#{1,3})\s+(.+)/)
    const headerLevel = headingMatch ? headingMatch[1].length : 1
    const headerText = headingMatch ? headingMatch[2].trim() : docTitle
    const body = lines.slice(headingMatch ? 1 : 0).join('\n').trim()
    const fullText = headingMatch ? `${firstLine}\n\n${body}` : body

    if (fullText.length < CHUNK_MIN_CHARS) continue

    if (fullText.length <= CHUNK_TARGET_CHARS) {
      chunks.push(makeChunk(fullText, headerText, headerLevel))
      continue
    }

    // Split long sections at paragraph boundaries
    const paragraphs = fullText.split(/\n\n+/)
    let current = ''

    for (const para of paragraphs) {
      if (current.length + para.length > CHUNK_TARGET_CHARS && current.length >= CHUNK_MIN_CHARS) {
        chunks.push(makeChunk(current.trim(), headerText, headerLevel))
        current = para
      } else {
        current = current ? `${current}\n\n${para}` : para
      }
    }

    if (current.trim().length >= CHUNK_MIN_CHARS) {
      chunks.push(makeChunk(current.trim(), headerText, headerLevel))
    }
  }

  return chunks
}

function makeChunk(text: string, headerText: string, headerLevel: number): Chunk {
  return {
    text,
    headerText,
    headerLevel,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
  }
}

// ── File discovery ────────────────────────────────────────────────────────────

async function walkMdx(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkMdx(full)))
    } else if (entry.name.endsWith('.mdx') && !entry.name.startsWith('_')) {
      files.push(full)
    }
  }
  return files
}

function filePathToUrl(filePath: string): string {
  const rel = relative(DOCS_ROOT, filePath)
    .replace(/\\/g, '/')
    .replace(/\.mdx$/, '')
    .replace(/\/index$/, '')
  const withoutLang = rel.replace(/^[a-z]{2}\//, '')
  return `${DOCS_BASE_URL}/${withoutLang}`
}

function extractTitle(raw: string, filePath: string): string {
  const match = raw.match(/^---[\s\S]*?title:\s*(.+?)[\s\S]*?---/m)
  if (match) return match[1].trim().replace(/^['"]|['"]$/g, '')
  return filePath.split('/').pop()?.replace('.mdx', '') ?? 'Untitled'
}

// Rough token estimate: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Zaron Docs Ingest — lang: ${LANG}, model: ${EMBEDDING_MODEL_ID}`)
  console.log(`   ${DRY_RUN ? '(dry-run) ' : ''}${FORCE ? '(force) ' : ''}\n`)

  const sql = DRY_RUN ? null : getDb()
  const bedrock = DRY_RUN ? null : getBedrockClient()

  // 1. Discover files
  const langDir = join(DOCS_ROOT, LANG)
  const filePaths = await walkMdx(langDir)
  console.log(`📄 Found ${filePaths.length} MDX files in content/docs/${LANG}/`)

  // 2. Load already-embedded documents (skip entire file unless --force)
  const embeddedDocs = (!DRY_RUN && !FORCE && sql)
    ? await getEmbeddedDocuments(sql)
    : new Set<string>()

  let totalFiles = 0
  let totalChunks = 0
  let totalSkipped = 0
  let totalEmbedded = 0

  // 3. Process each file
  for (const filePath of filePaths) {
    const sourceDocument = relative(langDir, filePath).replace(/\\/g, '/')
    const sourceLink = filePathToUrl(filePath)

    const raw = await readFile(filePath, 'utf-8')
    const title = extractTitle(raw, filePath)
    const plain = mdxToPlainText(raw)
    const chunks = chunkText(plain, title)

    if (chunks.length === 0) continue

    totalFiles++
    totalChunks += chunks.length

    if (!FORCE && embeddedDocs.has(sourceDocument)) {
      totalSkipped += chunks.length
      continue
    }

    if (DRY_RUN) {
      console.log(`  [dry] ${sourceDocument} — ${chunks.length} chunks`)
      continue
    }

    process.stdout.write(`  ${sourceDocument} (${chunks.length} chunks)... `)

    // Embed each chunk individually — Titan V2 is fast and cheap enough
    const dbRows: Array<{
      chunkText: string
      sourceLink: string
      headerText: string
      headerLevel: number
      tokenCount: number
      embedding: number[]
      metadata: Record<string, unknown>
    }> = []

    for (const chunk of chunks) {
      const embedding = await embedText(bedrock!, chunk.text)
      dbRows.push({
        chunkText: chunk.text,
        sourceLink,
        headerText: chunk.headerText,
        headerLevel: chunk.headerLevel,
        tokenCount: estimateTokens(chunk.text),
        embedding,
        metadata: { lang: LANG, title, hash: chunk.hash },
      })
      // Small delay to stay well under Bedrock throttle limits
      await new Promise((r) => setTimeout(r, BEDROCK_BATCH_DELAY_MS))
    }

    await writeChunks(sql!, sourceDocument, dbRows)
    totalEmbedded += dbRows.length
    console.log(`✓`)
  }

  await sql?.end()

  if (DRY_RUN) {
    console.log(`\n✅ Dry run — ${totalFiles} files, ${totalChunks} chunks (no DB writes)\n`)
  } else {
    console.log(`\n✅ Done — ${totalEmbedded} chunks embedded, ${totalSkipped} skipped.\n`)
  }
}

main().catch((err) => {
  console.error('❌ Ingest failed:', err)
  process.exit(1)
})
