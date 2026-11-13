# ClickStack Technology Stack

## Frontend (`packages/app`)

- **Framework**: Vinext 1.4 with Vite 8 and TypeScript
- **UI Components**: Mantine UI library (`@mantine/core`, `@mantine/dates`,
  `@mantine/hooks`)
- **State Management**: Jotai (global client state), TanStack Query (server
  state), URL params (filters)
- **Charts/Visualization**: Recharts, uPlot
- **Code Editor**: CodeMirror (for SQL/JSON editing)
- **Styling**: Mantine's built-in system, SCSS modules when needed
- **Icons**: Use `@tabler/icons-react`

**UI Component Priority**: Mantine components first → Custom components on
Mantine primitives → Custom SCSS modules as last resort

## Backend (`packages/api`)

- **Runtime**: Bun 1.4.4 with TypeScript
- **Framework**: Express.js
- **Database**: ClickHouse (telemetry data), MongoDB via Mongoose (metadata)
- **Authentication**: WorkOS AuthKit for browser and MCP authentication when
  configured; Passport.js local authentication otherwise
- **Validation**: Zod schemas
- **Telemetry**: Self-instrumented with `@clickhouse/clickstack-node` (API and
  Next.js server) and `@clickhouse/clickstack-browser` (frontend)

## Common Utilities (`packages/common-utils`)

- Shared TypeScript utilities for query parsing and ClickHouse operations
- Zod schemas for data validation
- SQL formatting and query building helpers

## Fork toolchain

The maintainer chose to retain Vinext and Vitest as project-specific exceptions
to the preferred TanStack Start framework and Bun test runner. Vinext keeps the
31-file Pages application and its Next.js APIs close to upstream. Vitest owns
application unit and integration testing: it reuses Vite transforms and
preserves the existing branch and statement coverage floors, which
[Bun's built-in coverage does not enforce](https://bun.com/docs/test/code-coverage).

`mise.toml` pins Bun and Go; `bun.lock` pins dependencies. tsrs checks every
TypeScript package and emits API/eval output and common-utils declarations.
TypeScript 6.0.3 remains a compiler API library for typed ESLint and Stryker's
mutation checker. The pinned `typescript-eslint` supports TypeScript below 6.1
([supported versions](https://typescript-eslint.io/users/dependency-versions/)).
tsrs owns ordinary checks and emit; its prerelease pin remains deliberate.
Express 5 and Zod 4 use the existing request-validation module, preserving
parsed query transforms and the API error-issues envelope.

Vitest 5 runs existing unit and integration tests with Istanbul coverage and the
existing coverage floors. The app keeps its pre-migration ESLint recommendation
scope: ESLint React 5's newly added rules are deferred, while every existing
Hooks rule and the 568-warning ceiling remain active. Vinext uses Vite for
development and production; Bun runs its standalone server. Optional Vercel
previews conditionally add `nitro@3.0.260903-beta`, the available official
Vinext Vite adapter. This is a preview-only prerelease constraint; ordinary Bun
self-host builds use Vinext's native standalone output. Remove the constraint
when Nitro 3 is stable. The preview bridge preserves Vinext's HTTP stream/header
interface when Express replaces request/response prototypes. The image starts
API, task and frontend processes with Bun. Dependency updates arrive as
Dependabot PRs; merging still requires review and passing checks.

The pinned passport-local-mongoose 9.0.1 patch makes its synchronous username
normalization hook compatible with Mongoose 9's promise-based middleware. It
removes only the obsolete callback; lowercasing and authentication behavior stay
the same. Remove the patch when the plugin ships this compatibility fix.

The API's telemetry preload (`src/telemetry.ts`) runs the ClickStack Node SDK
under Bun. It gives Bun's HTTPS server its own `emit` before init, because
instrumenting HTTPS after HTTP would otherwise unwrap the HTTP server spans, and
it scrubs OAuth credentials from HTTP span URLs. The SDK warns once at startup
that its ESM loader hook is unavailable on Bun; the compiled API is CommonJS.

Webhook delivery imports `undici/index.js` rather than `undici`: Bun maps the
bare specifier to a built-in fetch that ignores `dispatcher`, which would skip
the webhook DNS check.

Bun implicit dotenv loading is disabled for the workspace and server packages so
frontend development settings cannot leak into API or test processes.
Development commands select their env files explicitly; Vite selects build-mode
env files. The production start command reads the usual production dotenv files.
API integration tests overload inherited values with their explicit test env
file, preserving isolation of the disposable test database.

The ClickStack browser SDK's ESM entry imports the installed `@rrweb/record`
package, so `bun.lock`'s rrweb 2.2 observer and mutation-buffer cleanup fixes
reach the browser. `scripts/ci/browser-sdk-memory.mjs` proves this in CI.
