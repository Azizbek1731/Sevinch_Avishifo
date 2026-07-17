/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@avishifo/shared'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
