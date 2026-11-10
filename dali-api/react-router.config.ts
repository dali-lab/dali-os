import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Fly terminates TLS, so react-router-serve sees http:// and a strict origin match rejects every https form post.
  allowedActionOrigins: [
    "os.dali.dartmouth.edu",
    "os-staging.dali.dartmouth.edu",
    "*.fly.dev",
  ],
} satisfies Config;
