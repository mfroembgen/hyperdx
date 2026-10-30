export function installObserverCounters() {
  const Native = window.MutationObserver;
  const observers = [];
  const metadata = new WeakMap();
  const observe = Native.prototype.observe;
  const disconnect = Native.prototype.disconnect;
  let created = 0;
  let disconnected = 0;
  Native.prototype.observe = function (target, options) {
    let value = metadata.get(this);
    if (!value) {
      value = { active: false, targets: [], seen: new WeakSet() };
      metadata.set(this, value);
      observers.push(new WeakRef(this));
      created++;
    }
    value.active = true;
    if (!value.seen.has(target)) {
      value.targets.push(new WeakRef(target));
      value.seen.add(target);
    }
    return Reflect.apply(observe, this, [target, options]);
  };
  Native.prototype.disconnect = function () {
    const value = metadata.get(this);
    if (value?.active) disconnected++;
    if (value) {
      value.active = false;
      value.targets = [];
      value.seen = new WeakSet();
    }
    return Reflect.apply(disconnect, this, []);
  };
  window.__recorderObserverCounts = () => {
    let detachedShadowTargets = 0;
    let active = 0;
    for (const weak of observers) {
      const observer = weak.deref();
      const value = observer && metadata.get(observer);
      if (!value?.active) continue;
      active++;
      for (const target of value.targets) {
        const node = target.deref();
        if (node?.nodeType === 11 && node.host && !node.host.isConnected) {
          detachedShadowTargets++;
        }
      }
    }
    return { created, disconnected, active, detachedShadowTargets };
  };
}

export class RecorderPage {
  constructor(page) {
    this.page = page;
  }

  async open(origin) {
    await this.page.goto(origin, { waitUntil: 'load', timeout: 10000 });
    await this.page.waitForFunction(
      () =>
        document.querySelector('iframe')?.contentDocument?.body &&
        window.HyperDX,
      undefined,
      { timeout: 5000 },
    );
  }

  initialize(origin) {
    return this.page.evaluate(url => {
      const sdk = window.HyperDX;
      sdk.init({
        apiKey: 'synthetic-local-recorder-only',
        service: 'browser-sdk-memory-test',
        url: `${url}/otel`,
        consoleCapture: false,
        maskAllInputs: true,
        maskAllText: true,
        replay: {},
      });
      sdk.enableAdvancedNetworkCapture();
      return {
        init: typeof sdk.init === 'function',
        resume: typeof sdk.resumeSessionRecorder === 'function',
        advancedCapture: typeof sdk.enableAdvancedNetworkCapture === 'function',
      };
    }, origin);
  }

  requestContractProbe() {
    return this.page.evaluate(async () => {
      await new Promise(resolve =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      );
      const response = await fetch('/api/contract-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture: 'small-synthetic', value: 1 }),
      });
      await response.text();
    });
  }

  exercise(probeName, cycles = 100, checkouts = 3) {
    return this.page.evaluate(
      async options => {
        const flush = () => new Promise(resolve => setTimeout(resolve, 0));
        for (let i = 0; i < options.checkouts; i++) {
          window.HyperDX.resumeSessionRecorder();
          await flush();
        }
        document
          .querySelector('iframe')
          .contentDocument.body.setAttribute(options.probeName, 'true');
        await flush();
        for (let i = 0; i < options.cycles; i++) {
          const host = document.createElement('test-dropdown');
          const header = document.createElement('span');
          header.slot = 'dropdown-head';
          header.textContent = 'synthetic';
          host.appendChild(header);
          const slot = document.createElement('slot');
          slot.name = 'dropdown-head';
          host.attachShadow({ mode: 'open' }).appendChild(slot);
          document.body.appendChild(host);
          await flush();
          host.remove();
          await flush();
        }
      },
      { probeName, cycles, checkouts },
    );
  }

  observerCounts() {
    return this.page.evaluate(() => window.__recorderObserverCounts());
  }
}
