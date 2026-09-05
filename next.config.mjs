/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/proxy/:port',
        destination: 'http://127.0.0.1::port',
      },
      {
        source: '/proxy/:port/:path*',
        destination: 'http://127.0.0.1::port/:path*',
      },
      {
        source: '/expo-app',
        destination: 'http://127.0.0.1:8082',
      },
      {
        source: '/expo-app/:path*',
        destination: 'http://127.0.0.1:8082/:path*',
      },
      {
        source: '/index.bundle',
        destination: 'http://127.0.0.1:8082/index.bundle',
      },
      {
        source: '/_expo/:path*',
        destination: 'http://127.0.0.1:8082/_expo/:path*',
      },
      {
        source: '/assets/:path*',
        destination: 'http://127.0.0.1:8082/assets/:path*',
      },
    ]
  },
}

export default nextConfig

