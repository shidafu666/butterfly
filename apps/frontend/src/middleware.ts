import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function middleware(request: NextRequest) {
  if (ALLOWED_METHODS.has(request.method)) {
    return NextResponse.next();
  }

  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: 'GET, HEAD, OPTIONS',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
