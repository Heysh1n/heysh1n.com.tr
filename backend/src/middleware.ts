import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ALWAYS_ALLOWED_HOSTS = new Set([
  'api.heysh1n.com.tr',
  'heysh1n.com.tr',
  'www.heysh1n.com.tr',
  'localhost',
  '127.0.0.1',
])

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

const applySecurityHeaders = (response: NextResponse): NextResponse => {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host')

  if (process.env.NODE_ENV === 'production' && host) {
    const hostname = host.split(':')[0].toLowerCase()

    if (ALWAYS_ALLOWED_HOSTS.has(hostname) || ALWAYS_ALLOWED_HOSTS.has(host.toLowerCase())) {
      return applySecurityHeaders(NextResponse.next())
    }

    const rawBackendUrl = process.env.PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL

    if (rawBackendUrl) {
      try {
        const expectedHost = new URL(rawBackendUrl).host.toLowerCase()

        if (host.toLowerCase() !== expectedHost && hostname !== expectedHost.split(':')[0]) {
          return applySecurityHeaders(new NextResponse('Direct access forbidden', { status: 403 }))
        }
      } catch (error) {
        console.error('Failed to parse backend URL in middleware:', error)
      }
    } else {
      const isIp = /^[\d.]+$/.test(hostname) || hostname.includes('[')

      if (hostname.endsWith('.onrender.com') || isIp) {
        return applySecurityHeaders(new NextResponse('Direct access forbidden', { status: 403 }))
      }
    }
  }

  return applySecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: '/:path*',
}
