import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { type NextRequest, NextResponse } from 'next/server'
import { getDocBySlug, searchDocs } from '@/lib/search-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Next.js ↔ Node.js adapter (mirrors apps/zaron/app/api/mcp/vega/route.ts) ─

class ResponseCapture {
  private _status = 200
  private _headers = new Headers()
  private _controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private _pending: Uint8Array[] = []
  private _ended = false
  private _headersWritten = false
  private _resolveHeaders: (() => void) | null = null
  private _resolveEnd: (() => void) | null = null
  private _closeListeners: Array<() => void> = []

  readonly readable: ReadableStream<Uint8Array>
  private readonly _headersReady: Promise<void>
  private readonly _endReady: Promise<void>

  constructor() {
    this._headersReady = new Promise<void>((r) => { this._resolveHeaders = r })
    this._endReady = new Promise<void>((r) => { this._resolveEnd = r })
    this.readable = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        this._controller = ctrl
        for (const c of this._pending) ctrl.enqueue(c)
        this._pending = []
      },
      cancel: () => { this._ended = true; this._resolveEnd?.() },
    })
  }

  private flush(chunk: unknown): void {
    let buf: Uint8Array | null = null
    if (typeof chunk === 'string') buf = new TextEncoder().encode(chunk)
    else if (chunk instanceof Uint8Array) buf = chunk
    else if (chunk != null) buf = new TextEncoder().encode(String(chunk))
    if (!buf) return
    if (!this._headersWritten) { this._headersWritten = true; this._resolveHeaders?.() }
    if (this._controller) this._controller.enqueue(buf)
    else this._pending.push(buf)
  }

  writeHead(status: number, headers?: Record<string, string | number | string[]>): this {
    this._status = status
    if (headers) {
      for (const [k, v] of Object.entries(headers))
        this._headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
    }
    if (!this._headersWritten) { this._headersWritten = true; this._resolveHeaders?.() }
    return this
  }

  flushHeaders(): this {
    if (!this._headersWritten) { this._headersWritten = true; this._resolveHeaders?.() }
    return this
  }

  write(chunk: unknown): boolean { this.flush(chunk); return true }

  end(chunk?: unknown): this {
    if (chunk !== undefined) this.flush(chunk)
    if (!this._headersWritten) { this._headersWritten = true; this._resolveHeaders?.() }
    if (!this._ended) {
      this._ended = true
      this._resolveEnd?.()
      try { this._controller?.close() } catch { /* already closed */ }
      for (const h of this._closeListeners) h()
    }
    return this
  }

  on(event: 'close' | 'error', handler: (() => void) | ((e: Error) => void)): this {
    if (event === 'close') this._closeListeners.push(handler as () => void)
    return this
  }

  async waitForHeaders(ms = 10_000): Promise<void> {
    if (this._headersWritten) return
    await Promise.race([this._headersReady, new Promise<void>((r) => setTimeout(r, ms))])
  }

  async waitForEnd(ms = 30_000): Promise<void> {
    if (this._ended) return
    await Promise.race([this._endReady, new Promise<void>((r) => setTimeout(r, ms))])
  }

  toNextResponse(): NextResponse {
    return new NextResponse(this.readable, { status: this._status, headers: this._headers })
  }
}

// ── MCP server ────────────────────────────────────────────────────────────────

function buildServer(): Server {
  const server = new Server(
    { name: 'zaron-docs', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_docs',
        description:
          'Search Zaron platform documentation. Returns page titles, URLs, and relevant excerpts. Use for block fields, feature details, how-to questions.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query — block names, feature names, configuration questions' },
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
            slug: { type: 'string', description: 'Page slug e.g. "/blocks/agent" or "/connections/google-calendar"' },
          },
          required: ['slug'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params as {
      name: string
      arguments?: Record<string, unknown>
    }

    if (name === 'search_docs') {
      const query = typeof args.query === 'string' ? args.query : ''
      if (!query) throw new McpError(ErrorCode.InvalidParams, "'query' is required")
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, args.limit), 20) : 8

      const results = await searchDocs(query, limit)
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No documentation found for "${query}".` }] }
      }
      const text = results
        .map((r) => `## ${r.title}\nURL: ${r.url}\n\n${r.excerpt}`)
        .join('\n\n---\n\n')
      return { content: [{ type: 'text' as const, text }] }
    }

    if (name === 'get_doc') {
      const slug = typeof args.slug === 'string' ? args.slug : ''
      if (!slug) throw new McpError(ErrorCode.InvalidParams, "'slug' is required")

      const text = await getDocBySlug(slug)
      if (!text) {
        return {
          content: [{ type: 'text' as const, text: `No page found for slug "${slug}". Try search_docs first.` }],
          isError: true,
        }
      }
      return { content: [{ type: 'text' as const, text }] }
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  })

  return server
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const capture = new ResponseCapture()
  const reqAdapter = {
    method: request.method,
    headers: Object.fromEntries(
      Array.from(request.headers.entries()).map(([k, v]) => [k.toLowerCase(), v])
    ),
  }

  await server.connect(transport)
  try {
    await transport.handleRequest(reqAdapter as never, capture as never, body)
    await capture.waitForHeaders()
    await capture.waitForEnd()
    return capture.toNextResponse()
  } finally {
    await server.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse(null, { status: 405 })
}
