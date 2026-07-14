/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@butterfly/shared-types'],
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:3001';
    const base = backendOrigin.replace(/\/$/, '');
    return [
      // Proxy App Service health-check path to the backend health endpoint.
      {
        source: '/health',
        destination: `${base}/health`,
      },
      {
        source: '/api/:path*',
        destination: `${base}/api/:path*`,
      },
    ];
  },
  experimental: {
    // needed for echarts server-side rendering
  },
};
module.exports = nextConfig;
