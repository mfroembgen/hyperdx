# HyperDX Technology Stack

## Frontend (`packages/app`)

- **Framework**: Vinext 1.3 with Vite 8 and TypeScript
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
- **Authentication**: Passport.js with local strategy
- **Validation**: Zod schemas
- **Telemetry**: Self-instrumented with `@hyperdx/node-opentelemetry`

## Common Utilities (`packages/common-utils`)

- Shared TypeScript utilities for query parsing and ClickHouse operations
- Zod schemas for data validation
- SQL formatting and query building helpers

## Fork toolchain

`mise.toml` pins Bun; `bun.lock` pins dependencies. tsrs checks every TypeScript
package and emits API/eval output. TypeScript 6.0.3 remains a compiler API
library for typed ESLint and declaration bundling because current
`typescript-eslint` requires TypeScript below 6.1. It is not the CI checker.
Express 4 and Zod 3 remain at their latest compatible releases because
`zod-express-middleware` requires those APIs. Upgrade that middleware contract
before moving these majors.

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

The API's tracing preload disables Pino instrumentation's automatic log sending
because its explicit HyperDX transport already exports each record. Trace
correlation and the other instrumentations remain enabled.

Bun implicit dotenv loading is disabled for the workspace and server packages so
frontend development settings cannot leak into API or test processes. Development
commands select their env files explicitly; Vite selects build-mode env files.
The production start command reads the usual production dotenv files. API
integration tests overload inherited values with their explicit test env file,
preserving isolation of the disposable test database.

The browser SDK's npm release embeds its recorder dependencies. The
`@hyperdx/browser@0.26.0` Bun patch adds an ESM entry generated from the exact
upstream release source, leaving its UMD entry and public types intact. The ESM
entry imports the installed RUM and session-recorder packages so `bun.lock`'s
rrweb 2.2.0 observer and mutation-buffer cleanup fixes reach the browser. It keeps
the published SDK's OpenTelemetry API 1.9.1 bundled to avoid adding an undeclared
dependency. The patch records its source revision and license. Remove it when an
upstream SDK release provides a modular entry or includes the recorder fixes.
