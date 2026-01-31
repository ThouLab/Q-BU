/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 開発時に左下などに出る Next.js のインジケーター（Nバッジ）を非表示
  devIndicators: {
    buildActivity: false,
  },
};

export default nextConfig;
