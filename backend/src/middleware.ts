import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ALWAYS_ALLOWED_HOSTS = new Set([
  'api.heysh1n.com.tr',
  'heysh1n.com.tr',
  'www.heysh1n.com.tr',
  'localhost',
  '127.0.0.1',
])

export function middleware(request: NextRequest) {
  const host = request.headers.get('host')

  if (process.env.NODE_ENV === 'production' && host) {
    const hostname = host.split(':')[0].toLowerCase()

    if (ALWAYS_ALLOWED_HOSTS.has(hostname) || ALWAYS_ALLOWED_HOSTS.has(host.toLowerCase())) {
      return NextResponse.next()
    }

    const rawBackendUrl = process.env.PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL

    if (rawBackendUrl) {
      try {
        const expectedHost = new URL(rawBackendUrl).host.toLowerCase()

        if (host.toLowerCase() !== expectedHost && hostname !== expectedHost.split(':')[0]) {
          return new NextResponse('Direct access forbidden', { status: 403 })
        }
      } catch (error) {
        console.error('Failed to parse backend URL in middleware:', error)
      }
    } else {
      const isIp = /^[\d.]+$/.test(hostname) || hostname.includes('[')

      if (hostname.endsWith('.onrender.com') || isIp) {
        return new NextResponse('Direct access forbidden', { status: 403 })
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/:path*',
}
