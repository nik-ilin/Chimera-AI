/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable ESLint during `next build` — run it separately via `npm run lint`.
  // This prevents the build hanging in environments where the linter process
  // stalls (e.g. paths with spaces). Linting is still enforced in CI/pre-commit.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
