import { Analytics } from '@vercel/analytics/next'
import SuppressExtensionErrors from '@/components/suppress-extension-errors'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Open Design AI — Design Review & Autonomous Testing Suite',
  description:
    'Compare Figma designs with live screens, collect client feedback, and run autonomous end-to-end AI testing simulations on your web applications.',
  generator: 'Next.js',
  icons: {
    icon: [
      { url: '/logo.png', type: 'image/png', sizes: '512x512' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.jpg', type: 'image/jpeg', sizes: '32x32' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="light bg-slate-100" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/screenshots/dashboard-preview.png" as="image" type="image/png" />

      </head>
      <body className="antialiased" suppressHydrationWarning>
        <SuppressExtensionErrors />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
