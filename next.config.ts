import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Серверні пакети — не бандлити (інакше дублюються класи: grammY InputFile
  // має один екземпляр, інакше instanceof падає → "InputFile must be sent via grammY").
  serverExternalPackages: ["grammy", "telegram", "@anthropic-ai/sdk", "openai", "exceljs"],
  eslint: {
    // Білд на Netlify не валимо через лінт — лінт ганяємо окремо.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
