import { type NextRequest, NextResponse } from 'next/server'
import { searchDocs } from '@/lib/search-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Docs full-text search via MiniSearch BM25 index.
 * Replaces the old pgvector/embeddings endpoint — no DB required.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = (searchParams.get('query') || searchParams.get('q') || '').trim()
  const limit = Math.min(Number.parseInt(searchParams.get('limit') || '10', 10), 20)

  if (!query) return NextResponse.json([])

  try {
    const results = await searchDocs(query, limit)

    const formatted = results.map((r) => {
      const pathParts = r.slug
        .replace(/^\//, '')
        .split('/')
        .filter((p) => p && p !== 'index')
        .map((p) =>
          p
            .replace(/-/g, ' ')
            .split(' ')
            .map((w) => {
              const upper = ['api', 'mcp', 'sdk', 'url', 'http', 'json', 'ai']
              return upper.includes(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
            })
            .join(' ')
        )

      return {
        id: r.id,
        type: 'page' as const,
        url: r.url,
        content: r.title,
        breadcrumbs: pathParts,
      }
    })

    return NextResponse.json(formatted)
  } catch {
    return NextResponse.json([])
  }
}
