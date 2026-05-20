import type { InferPageType } from 'fumadocs-core/source'
import type { PageData, source } from '@/lib/source'

export async function getLLMText(page: InferPageType<typeof source>) {
  const data = page.data as unknown as PageData
  if (typeof data.getText !== 'function') return ''
  const raw = await data.getText('raw')
  return `# ${data.title} (${page.url})

${raw}`
}
