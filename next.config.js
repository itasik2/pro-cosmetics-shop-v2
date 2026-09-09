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
    value: "max-age=31536000; includeSubDomains",
  },
];

const privatePageHeaders = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet",
  },
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
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
