/** @type {import('next').NextConfig} */

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self' 'unsafe-inline' https://cloud.umami.is",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https:",
      "frame-src 'self' https:",
      "form-action 'self' https:",
      "worker-src 'self' blob:",
    ].join("; "),
  },
];

const privatePageHeaders = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/price-imports/upload": [
        "./node_modules/pdfjs-dist/legacy/build/**/*",
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/admin/:path*",
        headers: privatePageHeaders,
      },
      {
        source: "/checkout/:path*",
        headers: privatePageHeaders,
      },
      {
        source: "/order/:path*",
        headers: privatePageHeaders,
      },
      {
        source: "/payment/:path*",
        headers: privatePageHeaders,
      },
      {
        source: "/success",
        headers: privatePageHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
