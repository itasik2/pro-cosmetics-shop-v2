/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
    serverComponentsExternalPackages: ["pdfjs-dist"],
    outputFileTracingIncludes: {
      "/api/admin/price-imports/upload": [
        "./node_modules/pdfjs-dist/legacy/build/**/*",
      ],
    },
  },
};

module.exports = nextConfig;
