/** @type {import('next').NextConfig} */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  },
];

const PRIVATE_PAGE_HEADERS = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
];

const nextConfig = {
  poweredByHeader: false,
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist"],
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
        headers: SECURITY_HEADERS,
      },
      {
        source: "/admin/:path*",
        headers: PRIVATE_PAGE_HEADERS,
      },
      {
        source: "/checkout/:path*",
        headers: PRIVATE_PAGE_HEADERS,
      },
      {
        source: "/order/:path*",
        headers: [
          ...PRIVATE_PAGE_HEADERS,
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

module.exports = nextConfig;
