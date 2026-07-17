import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@avishifo/shared'],
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(nextConfig);
