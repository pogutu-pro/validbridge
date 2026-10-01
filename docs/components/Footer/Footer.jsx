'use client'

import Link from 'next/link'

const links = [
  { label: 'Documentation', href: '/' },
  { label: 'ValidBridge', href: 'https://validbridge.co.ke' },
  { label: 'Support', href: 'mailto:support@validbridge.co.ke' },
  { label: 'Stratnovo Systems', href: 'https://stratnovo.co.ke' },
]

export default function Footer() {
  return (
    <footer className="lh-footer">
      <div className="lh-footer-container">
        <p className="lh-footer-copyright">
          &copy; {new Date().getFullYear()} ValidBridge · a product of{' '}
          <a href="https://stratnovo.co.ke" target="_blank" rel="noopener noreferrer" className="lh-footer-link">
            Stratnovo Systems
          </a>
        </p>
        <nav className="lh-footer-nav">
          {links.map((link) => {
            const isExternal = link.href.startsWith('http') || link.href.startsWith('mailto:')
            const Tag = isExternal ? 'a' : Link
            const props = isExternal
              ? link.href.startsWith('mailto:')
                ? { href: link.href }
                : { href: link.href, target: '_blank', rel: 'noopener noreferrer' }
              : { href: link.href }
            return (
              <Tag key={link.label} {...props} className="lh-footer-link">
                {link.label}
              </Tag>
            )
          })}
        </nav>
      </div>
    </footer>
  )
}
