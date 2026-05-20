import MiniSearch from 'minisearch'
import { source } from '@/lib/source'
import { getLLMText } from '@/lib/llms'

export interface DocPage {
  id: string
  slug: string
  title: string
  description: string
  url: string
  text: string
}

interface SearchResult {
  id: string
  slug: string
  title: string
  description: string
  url: string
  excerpt: string
  score: number
}

let _index: MiniSearch | null = null
let _pages: Map<string, DocPage> | null = null

async function buildIndex(): Promise<{ index: MiniSearch; pages: Map<string, DocPage> }> {
  const pages = source.getPages('en')
  const pageMap = new Map<string, DocPage>()

  const miniSearch = new MiniSearch({
    fields: ['title', 'description', 'text'],
    storeFields: ['slug', 'title', 'description', 'url'],
    searchOptions: {
      boost: { title: 3, description: 1.5, text: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })

  const docs: DocPage[] = []
  for (const page of pages) {
    try {
      const text = await getLLMText(page)
      const data = page.data as { title?: string; description?: string }
      const doc: DocPage = {
        id: page.url,
        slug: page.url,
        title: data.title ?? page.url,
        description: data.description ?? '',
        url: page.url,
        text,
      }
      docs.push(doc)
      pageMap.set(page.url, doc)
    } catch {
      // skip pages that fail to render
    }
  }

  await miniSearch.addAllAsync(docs)
  return { index: miniSearch, pages: pageMap }
}

async function getIndex(): Promise<{ index: MiniSearch; pages: Map<string, DocPage> }> {
  if (_index && _pages) return { index: _index, pages: _pages }
  const { index, pages } = await buildIndex()
  _index = index
  _pages = pages
  return { index, pages }
}

export async function searchDocs(query: string, limit = 8): Promise<SearchResult[]> {
  const { index, pages } = await getIndex()
  const hits = index.search(query, { boost: { title: 3 }, fuzzy: 0.2, prefix: true }).slice(0, limit)

  return hits.map((hit) => {
    const page = pages.get(hit.id as string)
    const text = page?.text ?? ''
    const queryLower = query.toLowerCase()
    const idx = text.toLowerCase().indexOf(queryLower)
    const excerpt =
      idx >= 0
        ? text.slice(Math.max(0, idx - 80), idx + 200).trim()
        : text.slice(0, 280).trim()

    return {
      id: hit.id as string,
      slug: hit.slug as string,
      title: hit.title as string,
      description: hit.description as string,
      url: hit.url as string,
      excerpt,
      score: hit.score,
    }
  })
}

export async function getDocBySlug(slug: string): Promise<string | null> {
  const { pages } = await getIndex()
  const normalised = slug.startsWith('/') ? slug : `/${slug}`
  const page = pages.get(normalised)
  return page?.text ?? null
}
