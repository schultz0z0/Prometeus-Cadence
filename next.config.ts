import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.NODE_ENV==='development'&&process.env.QA_OPENWA_DEV==='1'?{distDir:'.runtime/next-openwa-qa'}:{}),
  devIndicators: false,
  // The OAuth consent and the sign-in it may pass through must never be framed by another site (clickjacking).
  async headers() {
    const deny = [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }];
    return [{ source: "/mcp/:path*", headers: deny }, { source: "/login", headers: deny }];
  },
  logging: {
    incomingRequests: {
      ignore: [/\/api\/auth\//, /\/reset-password/, /\/accept-invitation/, /\/api\/mail-oauth\/google\/callback/, /\/api\/ai-oauth\/chatgpt\/callback/],
    },
  },
};
export default config;
