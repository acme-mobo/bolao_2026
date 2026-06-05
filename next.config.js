import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd()),
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore', 'grpc'],
};

export default nextConfig;
