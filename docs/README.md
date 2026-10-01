<p align="center">
  <a href="https://docs.validbridge.co.ke">
    <img alt="ValidBridge" src=".github/images/validbridge-github.png" width="600" />
  </a>
</p>

<p align="center">
  <strong>ValidBridge Documentation</strong>
</p>

<p align="center">
  Official documentation for <a href="https://validbridge.co.ke">ValidBridge</a>, the learning platform built by <a href="https://stratnovo.co.ke">Stratnovo Systems</a>.
</p>

<p align="center">
  <a href="https://docs.validbridge.co.ke">docs.validbridge.co.ke</a>
</p>

---

## Local Development

This site lives in the [`validbridge/validbridge`](https://github.com/pogutu-pro/validbridge)
monorepo under `docs/`. Run all commands from that directory.

**Prerequisites:** [Bun](https://bun.sh) installed.

```bash
# Clone the monorepo and move into the docs app
git clone https://github.com/pogutu-pro/validbridge.git
cd validbridge/docs

# Install dependencies
bun install

# Start the dev server
bun dev
```

The site will be available at `http://localhost:3000`.

## Project Structure

```
content/          # MDX documentation pages
  getting-started/
  platform/
  self-hosting/
  developers/
  enterprise/
  cli/
app/              # Next.js App Router
components/       # React components
public/           # Static assets
scripts/          # Build scripts
```

## Built With

- [Next.js](https://nextjs.org)
- [Nextra](https://nextra.site)
- [Tailwind CSS](https://tailwindcss.com)
