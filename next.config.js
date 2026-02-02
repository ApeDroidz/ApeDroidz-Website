/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  // === 1. Твои настройки Webpack (ВАЖНО ДЛЯ БЭКЕНДА) ===
  webpack: (config, { isServer }) => {
    const emptyModulePath = path.resolve(__dirname, 'webpack-empty-module.js');

    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      'thread-stream/test': emptyModulePath,
      'thread-stream/bench': emptyModulePath,
    };

    config.ignoreWarnings = [
      { module: /thread-stream\/test/ },
      { module: /thread-stream\/bench/ },
      { file: /thread-stream\/test/ },
      { file: /thread-stream\/bench/ },
    ];

    return config;
  },

  // === 2. External Packages ===
  experimental: {
    serverComponentsExternalPackages: ['thread-stream', 'pino'],
  },

  // === 3. Оптимизация ===
  compress: true,

  // === 4. Настройки изображений (ФИНАЛ) ===
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    dangerouslyAllowSVG: true,
    remotePatterns: [
      // === 1. SUPABASE (Твой главный быстрый источник) ===
      { protocol: 'https', hostname: 'jpbalgwwwalofynoaavv.supabase.co' },

      // === 2. IPFS Шлюзы (Для подстраховки и старых ссылок) ===
      { protocol: 'https', hostname: 'cf-ipfs.com' }, // Cloudflare
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'dweb.link' },
      { protocol: 'https', hostname: 'gateway.lighthouse.storage' },
      { protocol: 'https', hostname: 'cloudflare-ipfs.com' },

      // === 3. Твои домены и утилиты ===
      { protocol: 'https', hostname: 'apedroidz.com' },
      { protocol: 'https', hostname: 'www.apedroidz.com' },
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'localhost' },
    ],
  },

  // === 5. CORS ЗАГОЛОВКИ ===
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  }
};

module.exports = nextConfig;