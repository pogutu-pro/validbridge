import { NextResponse } from 'next/server'
import { siteOrigins } from '@lib/site/origin'
import { LEGAL_DOCS, legalToMarkdown } from '@lib/site/legal'

// Markdown copies of the legal pages (/terms.md, /privacy.md) for crawlers and
// LLMs. The HTML page stays canonical; this points back to it.
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ doc: string }> }) {
  const { doc } = await ctx.params
  const legal = LEGAL_DOCS[doc as keyof typeof LEGAL_DOCS]
  if (!legal) return new NextResponse('Not found', { status: 404 })
  const { appOrigin } = await siteOrigins()
  return new NextResponse(legalToMarkdown(legal, appOrigin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      Link: `<${appOrigin}/${legal.slug}>; rel="canonical"`,
    },
  })
}
