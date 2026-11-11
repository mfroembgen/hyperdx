import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSdk } from './browser-sdk-memory/build.mjs';
import {
  assertSdkContract,
  createExportCounter,
} from './browser-sdk-memory/exports.mjs';
import {
  installObserverCounters,
  RecorderPage,
} from './browser-sdk-memory/fixture.mjs';

export { assertSdkContract, createExportCounter };

async function until(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'SDK export condition timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function verifyBrowserSdkMemory(options = {}) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const output = resolve(options.output ?? 'artifacts/browser-sdk-memory');
  const temporary = await mkdtemp(join(tmpdir(), 'browser-sdk-memory-'));
  await mkdir(output, { recursive: true });
  const probeName = 'data-recorder-probe';
  const counter = createExportCounter(probeName);
  let browser;
  let server;
  let monitor;
  let watchdog;
  let expectedDisconnect = false;
  const result = {
    publishedControl: Boolean(options.publishedControl),
    crashed: false,
    unexpectedBrowserDisconnect: false,
    pageErrors: 0,
    memoryBudgetStop: false,
  };
  try {
    const bundle = await buildSdk(
      root,
      temporary,
      output,
      options.publishedControl,
    );
    result.bundleSha256 = bundle.sha256;
    result.moduleGraph = bundle.moduleGraph;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/sdk.js')
          return new Response(bundle.bytes, {
            headers: { 'Content-Type': 'application/javascript' },
          });
        if (path === '/frame')
          return new Response('<!doctype html><p>local iframe</p>', {
            headers: { 'Content-Type': 'text/html' },
          });
        if (path === '/api/contract-probe')
          return Response.json({ ok: true, fixture: 'small-synthetic' });
        if (path.startsWith('/otel/')) {
          counter.accept(Buffer.from(await request.arrayBuffer()));
          return new Response(null, { status: 204 });
        }
        return new Response(
          '<!doctype html><h1>SDK lifecycle fixture</h1><iframe src="/frame"></iframe><script src="/sdk.js"></script>',
          {
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy':
                "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; frame-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; form-action 'none'; object-src 'none'",
            },
          },
        );
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    browser = await bundle.chromium.launch({ headless: true, timeout: 15000 });
    browser.on('disconnected', () => {
      if (!expectedDisconnect) result.unexpectedBrowserDisconnect = true;
    });
    watchdog = setTimeout(() => {
      result.deadlineStop = true;
      void browser.close();
    }, 45000);
    watchdog.unref();
    result.browserVersion = browser.version();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort('blockedbyclient'),
    );
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(installObserverCounters);
    const page = await context.newPage();
    page.on('crash', () => {
      result.crashed = true;
    });
    page.on('pageerror', () => {
      result.pageErrors++;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    monitor = setInterval(() => {
      void cdp
        .send('Performance.getMetrics')
        .then(data => {
          const heap =
            data.metrics.find(metric => metric.name === 'JSHeapUsedSize')
              ?.value ?? 0;
          if (heap >= 1024 ** 3) {
            result.memoryBudgetStop = true;
            void context.close();
          }
        })
        .catch(() => {});
    }, 500);
    monitor.unref();
    const fixture = new RecorderPage(page);
    await fixture.open(origin);
    result.api = await fixture.initialize(origin);
    await until(() => counter.summary().fullSnapshots > 0);
    await fixture.requestContractProbe();
    await until(() => {
      const value = counter.summary();
      return (
        value.networkSpans > 0 && value.requestBodies + value.responseBodies > 0
      );
    });
    result.before = await fixture.observerCounts();
    await fixture.exercise(probeName);
    await until(
      () =>
        counter.summary().probeMutations > 0 &&
        counter.summary().fullSnapshots >= 4,
    );
    let lastCount = -1;
    let stableAt = Date.now();
    await until(() => {
      const count = counter.summary().probeMutations;
      if (count !== lastCount) {
        lastCount = count;
        stableAt = Date.now();
      }
      return Date.now() - stableAt >= 200;
    }, 3000);
    result.after = await fixture.observerCounts();
    result.exports = counter.summary();
    assertSdkContract(result);
    assert.equal(result.crashed, false, 'browser renderer crashed');
    assert.equal(
      result.unexpectedBrowserDisconnect,
      false,
      'browser disconnected unexpectedly',
    );
    assert.equal(
      result.pageErrors,
      0,
      'SDK fixture emitted an unhandled page error',
    );
    assert.equal(
      result.memoryBudgetStop,
      false,
      'browser exceeded the 1GiB safety budget',
    );
    assert.equal(
      result.exports.probeMutations,
      1,
      'one iframe mutation must be emitted once after repeated snapshots',
    );
    assert.ok(
      result.after.created - result.before.created >= 100,
      'shadow observers must actually be exercised',
    );
    assert.equal(
      result.after.detachedShadowTargets,
      0,
      'removed shadow roots must not keep active observers',
    );
    result.passed = true;
    return result;
  } catch (error) {
    result.passed = false;
    result.error = error.message;
    throw error;
  } finally {
    clearInterval(monitor);
    clearTimeout(watchdog);
    expectedDisconnect = true;
    await browser?.close();
    server?.stop(true);
    result.exports = counter.summary();
    await writeFile(
      join(output, 'result.json'),
      JSON.stringify(result, null, 2),
    );
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const output = process.argv
    .find(value => value.startsWith('--output-dir='))
    ?.slice(13);
  try {
    const result = await verifyBrowserSdkMemory({
      output,
      publishedControl: process.argv.includes('--published-umd'),
    });
    console.log(
      JSON.stringify({
        passed: result.passed,
        bundleSha256: result.bundleSha256,
        browserVersion: result.browserVersion,
        exports: result.exports,
        before: result.before,
        after: result.after,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
