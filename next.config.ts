import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.NODE_ENV==='development'&&process.env.QA_OPENWA_DEV==='1'?{distDir:'.runtime/next-openwa-qa'}:{}),
  devIndicators: false,
  logging: {
    incomingRequests: {
      ignore: [/\/api\/auth\//, /\/reset-password/, /\/accept-invitation/, /\/api\/mail-oauth\/google\/callback/, /\/api\/ai-oauth\/chatgpt\/callback/],
    },
  },
};
export default config;
