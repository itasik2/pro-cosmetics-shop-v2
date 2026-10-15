/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // PDF.js v4 resolves its fake worker using a sibling pdf.worker.mjs file.
  // Bundling pdf.mjs into .next/server/vendor-chunks breaks that relative URL.
  // Load pdfjs-dist as an external Node.js package so its worker is resolved
  // from node_modules/pdfjs-dist/legacy/build/, not from .next/server/.
  serverExternalPackages: ["pdfjs-dist"],
  // PDF.js loads this sibling file at runtime. Next's file tracing does not
  // detect that dynamic lookup, so include it in Vercel's function bundle.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
