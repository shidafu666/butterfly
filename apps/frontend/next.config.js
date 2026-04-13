/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@butterfly/shared-types'],
  experimental: {
    // needed for echarts server-side rendering
  },
};
module.exports = nextConfig;
