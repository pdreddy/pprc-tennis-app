/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: "100mb" } },
};

export default nextConfig;
