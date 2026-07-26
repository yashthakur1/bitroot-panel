import localFont from 'next/font/local'

// Self-hosted variable fonts. Kept local rather than pulled from Google at
// build time — the phone rebuilds on every deploy and shouldn't depend on
// reaching the network for fonts.

// Display: page and section headings.
export const funnelDisplay = localFont({
  src: '../../public/fonts/FunnelDisplay-Variable.woff2',
  weight: '300 800',
  variable: '--font-display',
  display: 'swap',
})

// Sans: everything else.
export const geist = localFont({
  src: '../../public/fonts/Geist-Variable.woff2',
  weight: '100 900',
  variable: '--font-sans',
  display: 'swap',
})

// Mono: code, logs, hostnames, ports, versions.
export const geistMono = localFont({
  src: '../../public/fonts/GeistMono-Variable.woff2',
  weight: '100 900',
  variable: '--font-mono',
  display: 'swap',
})
