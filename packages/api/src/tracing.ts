import { initSDK } from '@hyperdx/node-opentelemetry';

initSDK({
  instrumentations: {
    // The API logger already exports through the HyperDX Pino transport.
    '@opentelemetry/instrumentation-pino': { disableLogSending: true },
  },
});
