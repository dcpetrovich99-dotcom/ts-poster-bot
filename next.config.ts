import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GramJS + ws — серверні пакети, не бандлити їх у клієнт.
  serverExternalPackages: ["telegram", "@anthropic-ai/sdk", "openai"],
  eslint: {
    // Білд на Netlify не валимо через лінт — лінт ганяємо окремо.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
