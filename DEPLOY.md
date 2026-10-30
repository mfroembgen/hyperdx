# HyperDX Deployment Guide

[HyperDX](https://hyperdx.io) helps engineers quickly figure out why production
is broken by making it easy to search & visualize logs and traces on top of any
ClickHouse cluster (imagine Kibana, for ClickHouse). You can learn more about
HyperDX in our [README](/README.md).

HyperDX can be deployed in a few different ways:

- [Bring Your Own ClickHouse](#bring-your-own-clickhouse)
- [All-in-one Docker Compose Stack](#all-in-one-docker-compose-stack)
- [Local Development Mode](#local-development-mode)

## Bring Your Own ClickHouse

If you already have an existing ClickHouse cluster, you can simply deploy a
HyperDX container that connects to your ClickHouse cluster. You'll need a
separate MongoDB instance to persist your users, dashboards, searches and more.

To get started, you can run the following image:

```bash
docker run -e MONGO_URI=mongodb://YOUR_MONGODB_URI -p 8080:8080 docker.hyperdx.io/hyperdx/hyperdx:2-beta
```

You'll need to set the `MONGO_URI` environment variable to the URI of your
MongoDB instance. Afterwards, you'll want to visit http://localhost:8080 to set
up your connection with ClickHouse.

Before deploying into production, set the `EXPRESS_SESSION_SECRET` environment
variable to a random string (e.g. `openssl rand -hex 32`). Without it the API
generates one per process, which signs users out on every restart and prevents
replicas from sharing sessions. The old public value `hyperdx is cool 👋` is
also replaced with a per-process secret when authentication is enabled.

To customize the frontend URL, set the `FRONTEND_URL` environment variable to
the URL your HyperDX instance is hosted on.

## All-in-one Docker Compose Stack

The easiest way to get started with HyperDX from scratch is to use our
all-in-one Docker Compose stack. This stack will start ClickHouse, an
OpenTelemetry collector, and HyperDX with a MongoDB instance.

To get started, clone this repository and run the following command:

```bash
docker compose up -d
```

This will start the HyperDX stack and open a port for the UI, API, and OTel
collector.

The Compose database stays on MongoDB 5.0.32 to preserve existing `.volumes/db`
data. MongoDB 5 is end of life; plan a separate backed-up database upgrade using
[MongoDB's supported upgrade paths](https://www.mongodb.com/docs/manual/release-notes/9.0-upgrade-standalone/).
Do not point MongoDB 9 directly at a MongoDB 5 data directory: upgrade through
each supported major version and complete its feature compatibility version
steps before continuing. Development and disposable test stacks use fresh
MongoDB 9 data directories.

When deploying into production, you'll want to disable any extra ports outside
of the otel collector and api container. Beware that exposing any port in Docker
Compose will make it publicly accessible even when using iptable-based firewalls
such as ufw. See the
[Docker docs](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)
for more information.

Generate a secret once with `openssl rand -hex 32`, then set
`EXPRESS_SESSION_SECRET=<generated value>` in `.env.local`, which Git ignores.
Do not put the secret in the tracked root `.env`. Compose forwards this value to
the app container when you load `.env.local` after `.env`:

```bash
docker compose --env-file .env --env-file .env.local up -d
```

Reuse the same secret across restarts and all replicas. Without it the API
generates one per process, which signs users out on every restart and prevents
replicas from sharing sessions. The old public value is not a production secret.

## Local Development Mode

HyperDX can also be deployed alongside your existing local development stack to
help you debug issues locally. This mode will start an OpenTelemetry collector,
ClickHouse, and HyperDX with a MongoDB in a single instance, without any
authentication or configuration persistence.

To get started, spin up the local mode container:

```bash
docker run -p 8080:8080 docker.hyperdx.io/hyperdx/hyperdx-local:2-beta
```

## WorkOS AuthKit

The maintained fork supports Google sign-in for the website and browser OAuth
for remote MCP clients through [WorkOS AuthKit](https://workos.com/docs/authkit).
Use the default hosted AuthKit domain and Google social login. Cloudflare,
additional authentication proxies and DNS changes are not required.

Set these API runtime variables together:

```dotenv
FRONTEND_URL=https://hyperdx.example.com
WORKOS_ENABLED=true
WORKOS_API_KEY=<application-api-key>
WORKOS_CLIENT_ID=<application-client-id>
WORKOS_AUTHKIT_DOMAIN=https://your-environment.authkit.app
WORKOS_TEAM_ID=<existing-hyperdx-team-object-id>
```

Use a fixed HTTPS public frontend origin and AuthKit origin. Partial
configuration, a missing shared session secret, and local mode combined with
WorkOS fail at startup. `WORKOS_ENABLED=true` also fails closed when its secret
is unavailable. To restore legacy authentication, remove the WorkOS credential
variables and unset the flag or set it to `false`; stale credentials combined
with `false` fail startup rather than silently changing authentication.

Keep `EXPRESS_SESSION_SECRET` stable, private and at least 32 characters long
across every replica and restart. The official WorkOS Node SDK encrypts its
session data with this secret; HyperDX stores that data and short-lived login
state in its existing shared MongoDB session store. Refresh tokens never reach
frontend JavaScript. Expired access tokens refresh through the SDK; transient
provider failures preserve the session for a later retry.

### Configure each application

1. Create an AuthKit application for each HyperDX environment. Use separate
   WorkOS environments where identities must be isolated. Multiple applications
   can share a user base, but each website must have its own client ID.
2. Enable Google social login and configure its Google OAuth credentials and
   WorkOS callback. Enable only the intended authentication methods. By default,
   HyperDX users must already belong to the configured team.
3. Set the application's redirect URI to
   `https://hyperdx.example.com/api/auth/workos/callback`, initiate-login URI to
   `https://hyperdx.example.com/api/auth/workos`, and default sign-out URI to
   `https://hyperdx.example.com/login`.
4. In Connect configuration, enable Client ID Metadata Documents and Dynamic
   Client Registration for compatible clients. Register the exact MCP resource
   indicator `https://hyperdx.example.com/api/mcp`. Do not use a shared audience
   or wildcard across environments.
5. Set `WORKOS_SESSION_ISSUER` when the application's session issuer differs
   from `https://api.workos.com/user_management/<WORKOS_CLIENT_ID>`. Applications
   in one WorkOS environment share the default application's issuer, so a
   non-default application requires that environment's actual issuer. HyperDX
   also verifies the current application's `client_id` for website sessions.

The website uses the SDK's AuthKit sessions. MCP separately verifies Connect
access tokens against the AuthKit domain's `/oauth2/jwks`, exact issuer and exact
MCP resource audience. These token classes cannot substitute for one another.
When first linking an identity, HyperDX verifies the WorkOS profile and binds
its issuer/subject to an existing local team member. Later website and MCP
requests resolve that stored binding and check current membership in MongoDB
without fetching the profile again. Machine-to-machine tokens and personal API
keys are rejected in this MCP mode. WorkOS handles OAuth registration, consent,
authorization codes and refresh; HyperDX does not implement a second OAuth server.

To let new users join the configured existing team, optionally set
`WORKOS_AUTO_JOIN_DOMAIN=example.com`. The default is off. The value accepts one
exact domain, ignores case, and rejects URLs, wildcards, lists and whitespace.
An empty value turns automatic join off; the policy alone does not enable WorkOS.
Only a verified email from WorkOS's user profile can create a passwordless local
account; email claims in tokens do not grant membership. Subdomains, suffixes
and lookalike domains do not match. Existing members outside that domain can
still link their accounts. Automatic join never moves an existing user to
another team, replaces a conflicting identity, or restores an existing teamless
account.

Password login, registration, invitation signup and password recovery are
unavailable in WorkOS mode. The `hdx` CLI's password-session flow remains a
legacy-mode feature. Deleting the configured team blocks the next protected
website or MCP request.
Using Remove Member in WorkOS mode clears local membership, revokes the old
personal REST API key, and retains the email and identity binding so automatic
join cannot restore access. Old website, MCP and legacy-session requests are
denied. After verifying eligibility, an administrator can restore the retained
user record's `team` to the configured `WORKOS_TEAM_ID`. Its identity binding is
retained, and the previous personal API key remains invalid.
Legacy mode retains physical member deletion.

Logout submits a same-origin POST, destroys the HyperDX session and redirects
to WorkOS to end the browser session. MCP clients retain separate OAuth grants;
revoke a client grant in WorkOS when removing its access. Provider revocation
of a JWT takes effect when its short access token expires or refresh fails;
local team authorization is checked on every request.

Automatic join provides onboarding only. Suspending a Google Workspace account
blocks new Google authentication. Existing WorkOS website sessions and MCP
grants may continue until their own expiry or revocation; suspension also does
not revoke personal REST API keys. Use this setup when blocking fresh Google
sign-ins is sufficient for offboarding.

The external REST API keeps personal-key authentication, and collector and
OpAMP listeners retain their existing contracts. Protect the deployment with
TLS and its trusted ingress. Database proxy requests strip browser and OAuth
credentials. API logs and telemetry redact authorization codes, state and
credentials while preserving tracing and business context.

Before rollout, verify [MCP setup](MCP.md), browser login and logout, unauthorized
users, exact environment/resource isolation, OAuth refresh, and requests across
multiple replicas and restarts. Provider setup and passing source checks do not
deploy HyperDX.
