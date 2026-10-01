/**
 * Extract ValidBridge Help Center articles into a compact plain-text payload
 * for the AI assistant's product-knowledge retrieval.
 *
 * Run with:  bun run extract:help
 *
 * The Help Center content is JSX (ReactNode), not plain text. This script
 * renders each article to static markup with react-dom/server, strips the
 * HTML, and writes a JSON payload the API can load at request time.
 *
 * Output: apps/api/src/services/ai/assistant/help_knowledge.json
 *
 * The payload is committed so the API can read it without a build step.
 * Re-run this script after editing any lib/help/*.tsx file.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HELP_CATEGORIES } from '../lib/help/index'
import type { HelpArticle, HelpContext } from '../lib/help/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = resolve(__dirname, '../../api/src/services/ai/assistant/help_knowledge.json')

// A dummy context for rendering. HelpLink uses this to build hrefs, which we
// strip anyway -- the link text is what matters for the prompt.
const DUMMY_CTX: HelpContext = { orgslug: null, appOrigin: 'https://validbridge.co.ke' }

/** Strip HTML tags and decode the entities react-dom emits. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr|div|pre|details|summary)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface KnowledgeEntry {
  id: string
  title: string
  summary: string
  audience: string[]
  keywords: string[]
  text: string
}

const entries: KnowledgeEntry[] = []

for (const category of HELP_CATEGORIES) {
  for (const article of category.articles as HelpArticle[]) {
    let text = ''
    try {
      const node = (article as any).content(DUMMY_CTX)
      const html = renderToStaticMarkup(node)
      text = htmlToText(html)
    } catch (err) {
      console.warn(`  ! skipped ${category.id}/${article.id}:`, err)
      continue
    }

    entries.push({
      id: `${category.id}/${article.id}`,
      title: article.title,
      summary: article.summary,
      audience: article.audience,
      keywords: article.keywords ?? [],
      text,
    })
  }
}

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, JSON.stringify(entries, null, 2) + '\n')

const totalChars = entries.reduce((n, e) => n + e.text.length, 0)
console.log(`Wrote ${entries.length} articles to ${OUTPUT}`)
console.log(`Total text: ${totalChars.toLocaleString()} chars`)
