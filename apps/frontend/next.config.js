/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@butterfly/shared-types'],
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
  experimental: {
    // needed for echarts server-side rendering
  },
};
module.exports = nextConfig;
