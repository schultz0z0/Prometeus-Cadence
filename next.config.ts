import type { NextConfig } from "next";
const config: NextConfig = {
  ...(process.env.NODE_ENV==='development'&&process.env.QA_OPENWA_DEV==='1'?{distDir:'.runtime/next-openwa-qa'}:{}),
  devIndicators: false,
  // Sign-in trusts only BETTER_AUTH_URL; in development, a localhost visit goes to that origin instead of failing to log in.
  async redirects() {
    const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3210";
    return process.env.NODE_ENV === "development" && new URL(base).hostname !== "localhost"
      ? [{ source: "/:path*", has: [{ type: "host" as const, value: "localhost" }], destination: base + "/:path*", permanent: false }]
      : [];
  },
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
