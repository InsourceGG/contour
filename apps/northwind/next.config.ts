import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@contour/sdk'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
  // Contour's public endpoints, served by the catch-all at /api/contour.
  async rewrites() {
    return [
      { source: '/.well-known/oauth-protected-resource', destination: '/api/contour/.well-known/oauth-protected-resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/contour/.well-known/oauth-protected-resource/:path*' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/contour/.well-known/oauth-authorization-server' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/contour/.well-known/oauth-authorization-server/:path*' },
      { source: '/.well-known/contour-project.json', destination: '/api/contour/.well-known/contour-project.json' },
      { source: '/api/mcp', destination: '/api/contour/api/mcp' },
      { source: '/api/oauth/:path*', destination: '/api/contour/api/oauth/:path*' },
      { source: '/oauth/authorize/decision', destination: '/api/contour/oauth/authorize/decision' },
      { source: '/api/host/:path*', destination: '/api/contour/api/host/:path*' },
    ];
  },
};
export default config;
