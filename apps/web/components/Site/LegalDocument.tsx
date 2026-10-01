import React from 'react'
import Link from 'next/link'
import { CaretRight, EnvelopeSimple } from '@phosphor-icons/react/dist/ssr'
import { COMPANY, SUPPORT_EMAIL } from '@lib/help/brand'
import { LEGAL_DOCS, formatLegalDate, plainText, type LegalDoc } from '@lib/site/legal'
import { SITE_LINKS } from '@lib/site/content'

// A legal document page, laid out like a Help Center article: breadcrumbs,
// title + summary, then the text. Fully server-rendered, one <h1>, numbered
// <h2> sections with stable anchors, and JSON-LD so search engines and LLMs
// read the same structure people see.

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g

/** Renders a string with [text](href) links. */
function Rich({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(LINK)) {
    const [whole, label, href] = m
    if (m.index! > last) parts.push(text.slice(last, m.index))
    const cls = 'font-medium !text-[var(--s-accent-700)] underline decoration-[var(--s-accent-300)] underline-offset-[3px] hover:decoration-[var(--s-accent-700)]'
    parts.push(
      href.startsWith('/') ? (
        <Link key={m.index} href={href} className={cls}>
          {label}
        </Link>
      ) : (
        <a key={m.index} href={href} className={cls} {...(href.startsWith('http') ? { rel: 'noopener' } : {})}>
          {label}
        </a>
      ),
    )
    last = m.index! + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function jsonLd(doc: LegalDoc, origin: string) {
  const url = `${origin}/${doc.slug}`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: `${doc.title} | ValidBridge`,
        headline: doc.title,
        description: doc.description,
        inLanguage: 'en',
        datePublished: doc.updated,
        dateModified: doc.updated,
        isPartOf: { '@type': 'WebSite', name: 'ValidBridge', url: `${origin}/` },
        publisher: { '@type': 'Organization', name: COMPANY.name, url: COMPANY.url, email: SUPPORT_EMAIL },
        about: { '@type': 'SoftwareApplication', name: 'ValidBridge', applicationCategory: 'EducationalApplication' },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        hasPart: doc.sections.map((s, i) => ({
          '@type': 'WebPageElement',
          name: `${i + 1}. ${s.title}`,
          url: `${url}#${s.id}`,
        })),
        abstract: doc.keyPoints.map(plainText).join(' '),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ValidBridge', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: doc.title, item: url },
        ],
      },
    ],
  }
}

export default function LegalDocument({ doc, origin }: { doc: LegalDoc; origin: string }) {
  const other = doc.slug === 'terms' ? LEGAL_DOCS.privacy : LEGAL_DOCS.terms
  const updated = formatLegalDate(doc.updated)

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify output with "<" escaped cannot break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(doc, origin)).replace(/</g, '\\u003c') }}
      />

      <section className="s-surface px-5 pb-14 pt-12 sm:px-8 md:pb-20 md:pt-16">
        <div className="s-container">
          <nav aria-label="Breadcrumb" className="mb-8">
            <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-sm text-[var(--s-subtle)]">
              <li>
                <Link href={SITE_LINKS.home} className="hover:!text-[var(--s-text)]">
                  ValidBridge
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight size={12} className="rtl:rotate-180" />
              </li>
              <li>Legal</li>
              <li aria-hidden>
                <CaretRight size={12} className="rtl:rotate-180" />
              </li>
              <li aria-current="page" className="font-medium text-[var(--s-text)]">
                {doc.title}
              </li>
            </ol>
          </nav>
          <div className="max-w-[760px]">
            <h1 className="!text-[clamp(38px,5.6vw,60px)]">{doc.title}</h1>
            <p className="s-lead !mt-5 mb-0">{doc.description}</p>
            <p className="s-subtle mb-0 mt-6 text-sm">
              Last updated <time dateTime={doc.updated}>{updated}</time>
            </p>
          </div>
        </div>
      </section>

      <div className="s-container grid gap-12 px-5 py-14 sm:px-8 md:py-20 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="On this page">
            <h2 className="!mb-3 !text-xs !font-semibold uppercase !tracking-[0.08em] text-[var(--s-subtle)]">On this page</h2>
            <ol className="m-0 list-none space-y-0.5 p-0 text-sm lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
              <li>
                <a href="#key-points" className="flex gap-2 rounded-lg px-2 py-1.5 text-[var(--s-muted)] hover:bg-[var(--s-surface)] hover:!text-[var(--s-text)]">
                  <span className="w-5 shrink-0" aria-hidden />
                  Key points
                </a>
              </li>
              {doc.sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex gap-2 rounded-lg px-2 py-1.5 text-[var(--s-muted)] hover:bg-[var(--s-surface)] hover:!text-[var(--s-text)]"
                  >
                    <span className="w-5 shrink-0 tabular-nums text-[var(--s-subtle)]">{i + 1}.</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="max-w-[720px]">
          <section id="key-points" aria-labelledby="key-points-h" className="mb-14 scroll-mt-24 rounded-[var(--s-r-lg)] bg-[var(--s-accent-100)] p-6 sm:p-8">
            <h2 id="key-points-h" className="!mb-4 !text-xl !tracking-[-0.015em]">
              Key points
            </h2>
            <ul className="m-0 list-none space-y-3 p-0">
              {doc.keyPoints.map((k) => (
                <li key={k} className="flex gap-3 leading-relaxed">
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--s-accent)]" aria-hidden />
                  <span>
                    <Rich text={k} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="s-muted mb-0 mt-5 text-sm">This summary is for convenience. The full text below is what applies.</p>
          </section>

          {doc.sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="group mb-12 scroll-mt-24">
              <h2 id={`${s.id}-h`} className="!mb-4 flex items-baseline gap-3 !text-[26px] !tracking-[-0.02em]">
                <span className="tabular-nums text-[var(--s-accent)]">{i + 1}.</span>
                <span>{s.title}</span>
                <a
                  href={`#${s.id}`}
                  aria-label={`Link to section: ${s.title}`}
                  className="text-base font-normal text-[var(--s-subtle)] opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                >
                  #
                </a>
              </h2>
              <div className="s-prose text-[16px] leading-[1.75] text-[var(--s-text)]">
                {s.blocks.map((b, j) =>
                  'p' in b ? (
                    <p key={j}>
                      <Rich text={b.p} />
                    </p>
                  ) : (
                    <ul key={j} className="list-disc space-y-2 ps-5 marker:text-[var(--s-accent)]">
                      {b.ul.map((li) => (
                        <li key={li} className="ps-1">
                          <Rich text={li} />
                        </li>
                      ))}
                    </ul>
                  ),
                )}
              </div>
            </section>
          ))}

          <div className="mt-16 grid gap-4 sm:grid-cols-2">
            <Link href={`/${other.slug}`} className="group rounded-[var(--s-r-md)] bg-[var(--s-surface)] p-6 transition-colors hover:bg-[var(--s-surface-2)]">
              <span className="s-subtle text-xs font-semibold uppercase tracking-[0.08em]">Also read</span>
              <span className="mt-1 block text-lg font-semibold text-[var(--s-text)]">{other.title} →</span>
            </Link>
            <a href={SITE_LINKS.support} className="group rounded-[var(--s-r-md)] bg-[var(--s-surface)] p-6 transition-colors hover:bg-[var(--s-surface-2)]">
              <span className="s-subtle flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em]">
                <EnvelopeSimple size={14} aria-hidden /> Questions
              </span>
              <span className="mt-1 block text-lg font-semibold text-[var(--s-text)]">{SUPPORT_EMAIL}</span>
            </a>
          </div>
        </article>
      </div>
    </>
  )
}
