import { isValidElement, type ReactNode } from 'react'
import type { HelpCategory, HelpContext } from './types'

export type HelpSearchEntry = {
  categoryId: string
  categoryTitle: string
  articleId: string
  title: string
  summary: string
  keywords: string
  text: string
}

export type HelpSearchResult = HelpSearchEntry & { score: number; snippet: string }

/** Props whose values are rendered text in the help prose components. */
const TEXT_PROPS = ['children', 'term', 'title', 'label', 'q', 'head', 'rows']

/**
 * Flatten an article's JSX into plain text for full-text search. Walks the
 * element tree without rendering it, collecting strings from children and from
 * the text-carrying props our prose components use (Def `term`, Table `rows`…).
 */
export function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>
    return TEXT_PROPS.map((key) => extractText(props[key] as ReactNode)).join(' ')
  }
  return ''
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

export function buildHelpIndex(categories: HelpCategory[], ctx: HelpContext): HelpSearchEntry[] {
  return categories.flatMap((category) =>
    category.articles.map((article) => ({
      categoryId: category.id,
      categoryTitle: category.title,
      articleId: article.id,
      title: article.title,
      summary: article.summary,
      keywords: (article.keywords ?? []).join(' '),
      text: extractText(article.content(ctx)).replace(/\s+/g, ' ').trim(),
    }))
  )
}

export function tokenize(query: string): string[] {
  return normalize(query)
    .split(/[^\p{L}\p{N}&'-]+/u)
    .filter((t) => t.length > 1 || /\d/.test(t))
}

function makeSnippet(text: string, tokens: string[], fallback: string): string {
  const lower = normalize(text)
  let at = -1
  for (const t of tokens) {
    const i = lower.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return fallback
  const start = Math.max(0, at - 60)
  const end = Math.min(text.length, at + 120)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/**
 * Rank articles for a query. Every token must appear somewhere in the article;
 * matches in the title weigh most, then keywords, summary, category and body.
 */
export function searchHelp(index: HelpSearchEntry[], query: string, limit = 12): HelpSearchResult[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const results: HelpSearchResult[] = []
  for (const entry of index) {
    const title = normalize(entry.title)
    const keywords = normalize(entry.keywords)
    const summary = normalize(entry.summary)
    const category = normalize(entry.categoryTitle)
    const text = normalize(entry.text)
    let score = 0
    let all = true
    for (const t of tokens) {
      let s = 0
      // A title word starting with the token ("(SSO)" for "sso") beats a match
      // inside a word ("lesson" for "sso").
      if (title.includes(t)) s += title.split(/[^\p{L}\p{N}&'-]+/u).some((w) => w.startsWith(t)) ? 12 : 8
      if (keywords.includes(t)) s += 6
      if (summary.includes(t)) s += 4
      if (category.includes(t)) s += 3
      if (text.includes(t)) s += 1
      if (s === 0) {
        all = false
        break
      }
      score += s
    }
    if (!all) continue
    if (title.includes(normalize(query))) score += 10
    results.push({
      ...entry,
      score,
      snippet: makeSnippet(entry.text, tokens, entry.summary),
    })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}
