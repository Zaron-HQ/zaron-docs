import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

const TITLE_FONT_SIZE = {
  large: 64,
  medium: 56,
  small: 48,
} as const

function getTitleFontSize(title: string): number {
  if (title.length > 45) return TITLE_FONT_SIZE.small
  if (title.length > 30) return TITLE_FONT_SIZE.medium
  return TITLE_FONT_SIZE.large
}

/**
 * Loads a Google Font dynamically by fetching the CSS and extracting the font URL.
 */
async function loadGoogleFont(font: string, weights: string, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${font}:wght@${weights}&text=${encodeURIComponent(text)}`
  const css = await (await fetch(url)).text()
  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/)

  if (resource) {
    const response = await fetch(resource[1])
    if (response.status === 200) {
      return await response.arrayBuffer()
    }
  }

  throw new Error('Failed to load font data')
}

/**
 * Zaron logo with icon and "Zaron" text for OG image.
 */
function ZaronLogoFull() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <svg width='32' height='32' viewBox='0 0 32 32' fill='none'>
        <rect width='32' height='32' rx='7' fill='#0070F3' />
        <path
          d='M8 11.5h10.5L8 22h16v-2.5H13.5L24 9H8v2.5z'
          fill='white'
        />
      </svg>
      <span
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: '#fafafa',
          letterSpacing: '-0.02em',
        }}
      >
        Zaron
      </span>
    </div>
  )
}

/**
 * Generates dynamic Open Graph images for documentation pages.
 * Style matches Cursor docs: dark background, title at top, logo bottom-left, domain bottom-right.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Documentation'

  const allText = `${title}docs.zaron.dev`
  const fontData = await loadGoogleFont('Geist', '400;500;600', allText)

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 64px',
        background: '#121212', // Dark mode background matching docs (hsla 0, 0%, 7%)
        fontFamily: 'Geist',
      }}
    >
      {/* Title at top */}
      <span
        style={{
          fontSize: getTitleFontSize(title),
          fontWeight: 500,
          color: '#fafafa', // Light text matching docs
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </span>

      {/* Footer: icon left, domain right */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <ZaronLogoFull />
        <span
          style={{
            fontSize: 20,
            fontWeight: 400,
            color: '#71717a',
          }}
        >
          docs.zaron.dev
        </span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Geist',
          data: fontData,
          style: 'normal',
        },
      ],
    }
  )
}
