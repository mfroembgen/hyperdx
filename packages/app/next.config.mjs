import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8'),
);
const { version } = packageJson;

// Generate the small release-headline asset for both development and builds.
// Container builds include the root changelog and parser; runtime serves the
// generated file without evaluating this config again.
try {
  const { default: parseWhatsNew } =
    await import('./scripts/parse-whats-new.js');
  const changelog = readFileSync(
    join(__dirname, '..', '..', 'CHANGELOG.md'),
    'utf-8',
  );
  const { releases } = parseWhatsNew(changelog, { maxReleases: 5 });

  writeFileSync(
    join(__dirname, 'public', 'whats-new.json'),
    JSON.stringify({ releases }),
  );
} catch (err) {
  // Preserve an existing generated asset when source inputs are unavailable.
  if (!existsSync(join(__dirname, 'public', 'whats-new.json'))) {
    throw new Error(
      `Failed to generate whats-new.json and no file exists from an earlier ` +
        `build, so the app would ship without it: ${err.message}`,
    );
  }
  console.warn(
    'Could not regenerate public/whats-new.json; using the existing file:',
    err.message,
  );
}

// The newest RELEASE version in the notes, which keys the Help-button "you
// haven't read the latest release notes" sparkle.
//
// Deliberately not NEXT_PUBLIC_APP_VERSION: any deployment that stamps a build
// id into that (a git short SHA, a CI build number) mints a new string on every
// deploy, so the nudge fired for every user on every deploy whether the notes
// had changed or not. This comes from the changelog headings instead, so it moves
// only when a release is published.
//
// Read back from disk rather than off the object written above, so the fallback
// path — regeneration failed and an earlier build's asset is being shipped — is
// keyed to the asset that actually ships.
const whatsNewVersion = JSON.parse(
  readFileSync(join(__dirname, 'public', 'whats-new.json'), 'utf-8'),
).releases[0]?.version;

// Include the package version in the generated public runtime configuration.
process.env.NEXT_PUBLIC_APP_VERSION = version;

if (process.env.NEXT_PUBLIC_CLICKHOUSE_BUILD) {
  process.env.NEXT_PUBLIC_HYPERDX_BASE_PATH = '/clickstack';
}

const basePath = process.env.NEXT_PUBLIC_HYPERDX_BASE_PATH;

const nextConfig = {
  // Transform package CSS imports and nuqs framework imports through Vinext.
  transpilePackages: ['@clickhouse/click-ui', 'nuqs'],
  basePath: basePath,
  env: {
    // Ensures bundler-time replacements for client/server code that references this env var
    NEXT_PUBLIC_APP_VERSION: version,
    // Inlined at build time rather than exposed through __ENV.js: builds that
    // omit that script (static exports, embedded builds) still need the sparkle.
    NEXT_PUBLIC_WHATS_NEW_VERSION: whatsNewVersion,
  },
  // Keep instrumentation packages external to preserve their runtime hooks.
  // https://github.com/open-telemetry/opentelemetry-js/issues/4297#issuecomment-2285070503
  serverExternalPackages: [
    '@opentelemetry/instrumentation',
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@hyperdx/node-opentelemetry',
    '@hyperdx/instrumentation-sentry-node',
    // Outside of Vercel preview deployments, the `/api/[...all]` catch-all
    // proxies to a separately-deployed API service and never imports the
    // `@hyperdx/api` package at runtime. Mark it (and its subpaths) as a
    // CommonJS external so production app builds (Docker fullstack image,
    // standalone output) keep the separate API service boundary and
    // do not pull in passport-saml, mongoose, AWS SDK, etc.
    ...(process.env.HDX_PREVIEW_INLINE_API !== 'true' ? ['@hyperdx/api'] : []),
  ],
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  async rewrites() {
    if (process.env.NEXT_PUBLIC_CLICKHOUSE_BUILD) return [];
    // URL-only OAuth clients discover these before receiving an MCP challenge.
    return [
      {
        source: '/.well-known/oauth-protected-resource/api/mcp',
        destination: '/api/.well-known/oauth-protected-resource/mcp',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/.well-known/oauth-protected-resource/mcp',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)?', // Matches all pages
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          ...(process.env.NEXT_PUBLIC_NOINDEX === 'true'
            ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
            : []),
        ],
      },
    ];
  },
  productionBrowserSourceMaps: false,
  ...(process.env.NEXT_OUTPUT_STANDALONE === 'true'
    ? {
        output: 'standalone',
      }
    : {}),
  ...(process.env.NEXT_PUBLIC_CLICKHOUSE_BUILD
    ? {
        assetPrefix: '/clickstack',
        basePath: '/clickstack',
        images: { unoptimized: true },
        output: 'export',
      }
    : {}),
  logging: {
    incomingRequests: {
      // We also log this in the API server, so we don't want to log it twice.
      ignore: [/\/api\/.*/],
    },
  },
};

export default nextConfig;
