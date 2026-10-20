import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  logging: {
    incomingRequests: {
      ignore: [/\/api\/auth\//, /\/reset-password/, /\/accept-invitation/],
    },
  },
};
export default config;
