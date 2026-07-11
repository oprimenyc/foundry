/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Runs instrumentation.ts register() at server boot so interrupted
    // deployment runs are resumed after a crash or restart.
    instrumentationHook: true,
  },
};

export default nextConfig;
