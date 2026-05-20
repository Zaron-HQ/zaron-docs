# docs

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
bun run dev
```

Open http://localhost:3001 with your browser to see the result.

This app has **no `@zaron/*` workspace dependencies**. Search and the Vega `search_documentation` tool use **MiniSearch (BM25)** via `GET /api/search` and MCP `POST /api/mcp` (`search_docs`). No database is required at runtime.

## Deploy on Vercel

1. Create a Vercel project with **root directory** `apps/docs` (or import a repo that only contains this app).
2. Set **Install command** to `bun install` and **Framework** to Next.js (auto-detected).
3. Optional env: `NEXT_PUBLIC_BLOB_BASE_URL` if you serve media from external blob storage (`lib/utils` `getAssetUrl`).
4. After deploy, point **`DOCS_URL`** on Vega to `https://docs.zaron.dev` (or your production URL).

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs
- [Bun Documentation](https://bun.sh/docs) - learn about Bun features and API
