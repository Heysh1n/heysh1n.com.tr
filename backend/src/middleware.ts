import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host');

  if (process.env.NODE_ENV === 'production' && host) {
    const rawBackendUrl = process.env.PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_SERVER_URL;
    
    if (rawBackendUrl) {
      try {
        const expectedHost = new URL(rawBackendUrl).host;
        
        if (host !== expectedHost) {
          return new NextResponse('Direct access forbidden', { status: 403 });
        }
      } catch (error) {
        console.error('Failed to parse backend URL in middleware:', error);
      }
    } else {
      // Fallback block if env var is missing: specifically block onrender.com and bare IPs
      const hostname = host.split(':')[0];
      const isIp = /^[\d.]+$/.test(hostname) || hostname.includes('['); // basic IPv4 and IPv6 check
      
      if (hostname.endsWith('.onrender.com') || isIp) {
        return new NextResponse('Direct access forbidden', { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/:path*',
};
