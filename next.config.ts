import type { NextConfig } from 'next';

// GITHUB_PAGES=true 時輸出純靜態網站（out/），部署在 https://juntinwu.github.io/00631l-balance-stratege/。
// 其他情況維持原本的 vinext / Cloudflare 設定。
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const basePath = isGitHubPages ? '/00631l-balance-stratege' : '';

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: 'export',
      basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      env: {
        NEXT_PUBLIC_BASE_PATH: basePath,
        NEXT_PUBLIC_SITE_ORIGIN: 'https://juntinwu.github.io',
      },
    }
  : {};

export default nextConfig;
