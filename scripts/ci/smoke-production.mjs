import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

assert.equal(process.versions.bun, '1.4.4', 'actual probe runtime');
if (process.env.SMOKE_EXPECTED_ARCH) {
  assert.equal(
    process.arch,
    { amd64: 'x64', arm64: 'arm64' }[process.env.SMOKE_EXPECTED_ARCH],
  );
}
const require = createRequire('/app/packages/api/package.json');
assert.equal(require('@hyperdx/common-utils/dist/types').SourceKind.Log, 'log');
assert.equal(
  (await import('/app/packages/common-utils/dist/types.mjs')).SourceKind.Log,
  'log',
);
assert.equal(typeof require('mongodb').MongoClient, 'function');

const api = process.env.SMOKE_API_URL || 'http://127.0.0.1:8000';
const app = process.env.SMOKE_APP_URL || 'http://127.0.0.1:8080';

async function waitFor(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return response;
    } catch {}
    await Bun.sleep(1000);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

await waitFor(`${api}/ready`);
if (process.env.SMOKE_EXPECTED_REVISION) {
  const health = await fetch(`${api}/health`);
  assert.equal(
    (await health.json()).version,
    process.env.SMOKE_EXPECTED_REVISION,
  );
}
const page = await waitFor(`${app}/login`);
assert.match(await page.text(), /<html/i);

const sessionFile = process.env.SMOKE_SESSION_FILE;
let cookie;
if (process.env.SMOKE_RESUME_SESSION === 'true') {
  assert.ok(sessionFile, 'session proof path');
  ({ cookie } = JSON.parse(await readFile(sessionFile, 'utf8')));
} else {
  const response = await fetch(`${api}/register/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'smoke@example.invalid',
      password: 'Smoke-Test-2026!pass',
      confirmPassword: 'Smoke-Test-2026!pass',
    }),
  });
  assert.equal(response.status, 200, 'registration');
  cookie = response.headers
    .getSetCookie()
    .map(value => value.split(';')[0])
    .join('; ');
  if (sessionFile)
    await writeFile(sessionFile, JSON.stringify({ cookie }), { mode: 0o600 });
}
assert.ok(cookie, 'session cookie');
const me = await fetch(`${api}/me`, { headers: { Cookie: cookie } });
assert.equal(me.status, 200, 'session survives process restart');
assert.ok((await me.json()).team, 'registered team');
if (process.env.SMOKE_RESUME_SESSION === 'true') {
  await fetch(`${api}/logout`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  const loggedOut = await fetch(`${api}/me`, { headers: { Cookie: cookie } });
  assert.equal(loggedOut.status, 401, 'logout revokes session');
}
console.log(
  `Production image passed ${process.arch} Bun, modules, frontend and session checks.`,
);
