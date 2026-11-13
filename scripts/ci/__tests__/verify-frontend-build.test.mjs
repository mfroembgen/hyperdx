import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  verifyFrontendBuild,
  verifyNativeAddons,
} from '../verify-frontend-build.mjs';

test('accepts one shared build while allowing runtime configuration to differ', async t => {
  const root = await mkdtemp(join(tmpdir(), 'frontend-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['expected', 'actual']) {
    await mkdir(join(root, name, 'client'), { recursive: true });
    await mkdir(join(root, name, 'server'), { recursive: true });
    await writeFile(join(root, name, 'server/BUILD_ID'), 'same-build');
    await writeFile(join(root, name, 'server/RSC_BUILD_ID'), 'same-rsc-build');
    await writeFile(join(root, name, 'client/app.js'), 'same bundle');
    await writeFile(join(root, name, 'client/__ENV.js'), name);
  }
  await verifyFrontendBuild(join(root, 'expected'), join(root, 'actual'));
});

test('rejects the same-index images when their frontend build differs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'frontend-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['expected', 'actual']) {
    await mkdir(join(root, name, 'server'), { recursive: true });
    await writeFile(join(root, name, 'server/BUILD_ID'), name);
    await writeFile(join(root, name, 'server/RSC_BUILD_ID'), 'same-rsc-build');
  }
  await assert.rejects(
    verifyFrontendBuild(join(root, 'expected'), join(root, 'actual')),
    /BUILD_ID/,
  );
});

test('rejects a native addon copied from the other platform', async t => {
  const root = await mkdtemp(join(tmpdir(), 'frontend-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const header = Buffer.alloc(20);
  header.set([0x7f, 0x45, 0x4c, 0x46]);
  header[5] = 1;
  header.writeUInt16LE(183, 18);
  await writeFile(join(root, 'addon.node'), header);
  assert.equal(await verifyNativeAddons(root, 'arm64'), 1);
  await assert.rejects(verifyNativeAddons(root, 'x64'), /addon.node/);
});
