import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    // Prevent webpack from spawning workers that double memory usage
    webpackBuildWorker: false,
    webpackMemoryOptimizations: true,
    // Limit concurrent static generation to reduce peak memory
    staticGenerationMaxConcurrency: 4,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/introduction',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
    ]
  },
}

export default withMDX(config)
