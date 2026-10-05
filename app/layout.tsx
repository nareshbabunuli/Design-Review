import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Design Review — Multi-Project Comparison Tool',
  description:
    'Compare design revisions, track client feedback, and generate polished review presentations for your agency projects.',
  generator: 'Next.js',
  icons: {
    icon: [
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
        <link rel="preload" href="/screenshots/simulator-preview.png" as="image" type="image/png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window === 'undefined') return;
                function isExtensionError(e) {
                  var str = (e && (e.message || (e.reason && e.reason.message) || e.filename || '')) + '';
                  var stack = (e && ((e.error && e.error.stack) || (e.reason && e.reason.stack) || '')) + '';
                  return (
                    str.indexOf('Verification timed out') !== -1 ||
                    str.indexOf('csSpoofGeo') !== -1 ||
                    stack.indexOf('chrome-extension://') !== -1 ||
                    str.indexOf('chrome-extension://') !== -1
                  );
                }
                window.addEventListener('error', function(event) {
                  if (isExtensionError(event)) {
                    event.stopImmediatePropagation();
                    event.preventDefault();
                  }
                }, true);
                window.addEventListener('unhandledrejection', function(event) {
                  if (isExtensionError(event)) {
                    event.stopImmediatePropagation();
                    event.preventDefault();
                  }
                }, true);
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
