import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    // Add module aliases for TypeScript paths
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": `${process.cwd()}/src`,
    };
    return config;
  },
};

export default nextConfig;
