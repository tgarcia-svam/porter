import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  // Next.js requires unsafe-inline for its runtime scripts and hydration chunks
  "script-src 'self' 'unsafe-inline'",
  // Tailwind and Next.js inject inline styles
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  // OAuth redirects + Application Insights telemetry + direct-to-blob upload
  "connect-src 'self' https://login.microsoftonline.com https://accounts.google.com https://*.applicationinsights.azure.com https://dc.services.visualstudio.com https://*.blob.core.windows.net",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://login.microsoftonline.com https://accounts.google.com",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: csp,
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["applicationinsights", "@azure/identity", "@azure/keyvault-secrets", "@azure/service-bus"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
