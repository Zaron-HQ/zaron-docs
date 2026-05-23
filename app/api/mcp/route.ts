/**
 * POST /api/mcp
 *
 * Lightweight JSON-RPC 2.0 MCP endpoint for the Zaron docs.
 * Implements the MCP tools/list and tools/call methods directly
 * without the full SDK transport layer (which fails in Vercel serverless).
 *
 * Tools:
 *   - search_docs: BM25 full-text search over all 235 English MDX pages
 *   - get_doc: Get full content of a page by slug
 *
 * Called by the Vega service's `search_documentation` local tool.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { getDocBySlug, searchDocs } from '@/lib/search-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface JsonRpcRequest {
  jsonrpc: string
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string }
}

const TOOLS = [
  {
    name: 'search_docs',
    description:
      'Search Zaron platform documentation. Returns page titles, URLs, and relevant excerpts. Use for block fields, feature details, how-to questions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — block names, feature names, configuration questions',
        },
        limit: { type: 'number', description: 'Max results (default 8, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_doc',
    description:
      'Get the full content of a documentation page by slug. Use after search_docs to read the complete page.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Page slug e.g. "/blocks/agent" or "/connections/google-calendar"',
        },
      },
      required: ['slug'],
    },
  },
]

async function handleToolsList(): Promise<{ tools: typeof TOOLS }> {
  return { tools: TOOLS }
}

async function handleToolsCall(
  params: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const name = params.name as string | undefined
  const args = (params.arguments ?? {}) as Record<string, unknown>

  if (name === 'search_docs') {
    const query = typeof args.query === 'string' ? args.query : ''
    if (!query) {
      return {
        content: [{ type: 'text', text: 'Error: "query" is required' }],
        isError: true,
      }
    }
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, args.limit), 20) : 8

    const results = await searchDocs(query, limit)
    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No documentation found for "${query}".` }],
      }
    }
    const text = results
      .map((r) => `## ${r.title}\nURL: ${r.url}\n\n${r.excerpt}`)
      .join('\n\n---\n\n')
    return { content: [{ type: 'text', text }] }
  }

  if (name === 'get_doc') {
    const slug = typeof args.slug === 'string' ? args.slug : ''
    if (!slug) {
      return {
        content: [{ type: 'text', text: 'Error: "slug" is required' }],
        isError: true,
      }
    }

    const text = await getDocBySlug(slug)
    if (!text) {
      return {
        content: [
          { type: 'text', text: `No page found for slug "${slug}". Try search_docs first.` },
        ],
        isError: true,
      }
    }
    return { content: [{ type: 'text', text }] }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: JsonRpcRequest
  try {
    body = (await request.json()) as JsonRpcRequest
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    )
  }

  if (!body.jsonrpc || body.jsonrpc !== '2.0' || !body.method) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32600, message: 'Invalid Request' } },
      { status: 400 }
    )
  }

  const response: JsonRpcResponse = { jsonrpc: '2.0', id: body.id ?? null }

  try {
    switch (body.method) {
      case 'initialize': {
        response.result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'zaron-docs', version: '1.0.0' },
        }
        break
      }

      case 'tools/list': {
        response.result = await handleToolsList()
        break
      }

      case 'tools/call': {
        const params = (body.params ?? {}) as Record<string, unknown>
        response.result = await handleToolsCall(params)
        break
      }

      default: {
        response.error = { code: -32601, message: `Method not found: ${body.method}` }
      }
    }
  } catch (err) {
    response.error = {
      code: -32603,
      message: err instanceof Error ? err.message : 'Internal error',
    }
  }

  return NextResponse.json(response)
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      name: 'zaron-docs',
      version: '1.0.0',
      description: 'Zaron documentation MCP server — search and retrieve platform docs.',
      tools: TOOLS.map((t) => t.name),
    },
    { status: 200 }
  )
}
