import { vi } from 'vitest';
// Mock OpenTelemetry + the HyperDX SDK before importing the module under test.

const mockSpan = vi.hoisted(() => ({
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  recordException: vi.fn(),
  end: vi.fn(),
}));

const mockTracer = vi.hoisted(() => ({
  startActiveSpan: (
    _name: string,
    _options: unknown,
    fn: (span: typeof mockSpan) => Promise<unknown>,
  ) => fn(mockSpan),
}));

const mockCounter = vi.hoisted(() => ({ add: vi.fn() }));
const mockHistogram = vi.hoisted(() => ({ record: vi.fn() }));
const mockMeter = vi.hoisted(() => ({
  createCounter: vi.fn(() => mockCounter),
  createHistogram: vi.fn(() => mockHistogram),
}));

const mockSetTraceAttributes = vi.hoisted(() => vi.fn());

vi.mock('@opentelemetry/api', () => ({
  __esModule: true,
  default: {
    trace: {
      getTracer: () => mockTracer,
      getActiveSpan: () => mockSpan,
    },
    metrics: {
      getMeter: () => mockMeter,
    },
  },
  SpanStatusCode: { OK: 1, ERROR: 2 },
  SpanKind: { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 },
}));

vi.mock('@hyperdx/node-opentelemetry', () => ({
  __esModule: true,
  setTraceAttributes: (...args: unknown[]) => mockSetTraceAttributes(...args),
  getPinoMixinFunction: () => ({}),
}));

vi.mock('@/config', () => ({
  HYPERDX_LOG_LEVEL: undefined,
  HYPERDX_API_KEY: undefined,
  IS_DEV: false,
  IS_CI: true,
  CODE_VERSION: 'test-version',
  IS_LOCAL_APP_MODE: false,
  IS_PROMQL_ENABLED: true,
  USAGE_STATS_ENABLED: false,
  RUN_SCHEDULED_TASKS_EXTERNALLY: false,
  AI_API_KEY: '',
  ANTHROPIC_API_KEY: 'present',
}));

import {
  getCounter,
  getHistogram,
  getStaticFeatureFlags,
  recordDuration,
  recordOperationOutcome,
  setBusinessContext,
  SpanStatusCode,
  withOperationMetrics,
  withSpan,
} from '@/utils/instrumentation';

describe('instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('withSpan', () => {
    it('runs the handler, sets OK status, and ends the span', async () => {
      const result = await withSpan('op', async () => 'value');

      expect(result).toBe('value');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('does not set OK status when recordOkStatus is false', async () => {
      await withSpan('op', async () => 'value', { recordOkStatus: false });

      expect(mockSpan.setStatus).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('records exceptions, sets ERROR status, ends the span, and rethrows', async () => {
      const error = new Error('boom');

      await expect(
        withSpan('op', async () => {
          throw error;
        }),
      ).rejects.toThrow('boom');

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'boom',
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('setBusinessContext', () => {
    it('maps team/user/email to standardized keys on trace and span', () => {
      setBusinessContext({
        teamId: 'team-1',
        userId: 'user-1',
        email: 'a@b.com',
      });

      const expected = {
        'hyperdx.team.id': 'team-1',
        'user.id': 'user-1',
        'user.email': 'a@b.com',
      };
      expect(mockSetTraceAttributes).toHaveBeenCalledWith(expected);
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(expected);
    });

    it('passes through extra attributes and skips nullish values', () => {
      setBusinessContext({
        teamId: 'team-1',
        userId: null,
        'feature_flag.local_app_mode': true,
      });

      expect(mockSetTraceAttributes).toHaveBeenCalledWith({
        'hyperdx.team.id': 'team-1',
        'feature_flag.local_app_mode': true,
      });
    });

    it('is a no-op when there is nothing to set', () => {
      setBusinessContext({});

      expect(mockSetTraceAttributes).not.toHaveBeenCalled();
      expect(mockSpan.setAttributes).not.toHaveBeenCalled();
    });
  });

  describe('getStaticFeatureFlags', () => {
    it('reflects config-derived flag states', () => {
      expect(getStaticFeatureFlags()).toEqual({
        'feature_flag.local_app_mode': false,
        'feature_flag.promql_enabled': true,
        'feature_flag.usage_stats_enabled': false,
        'feature_flag.ai_assistant_enabled': true,
        'feature_flag.scheduled_tasks_external': false,
      });
    });
  });

  describe('metric accessors', () => {
    it('memoizes counters by name', () => {
      const a = getCounter('hyperdx.test.counter');
      const b = getCounter('hyperdx.test.counter');

      expect(a).toBe(b);
      expect(mockMeter.createCounter).toHaveBeenCalledTimes(1);
    });

    it('memoizes histograms by name', () => {
      const a = getHistogram('hyperdx.test.histogram');
      const b = getHistogram('hyperdx.test.histogram');

      expect(a).toBe(b);
      expect(mockMeter.createHistogram).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordDuration', () => {
    it('records duration and returns the result on success', async () => {
      const histogram = getHistogram('hyperdx.test.duration');
      const result = await recordDuration(histogram, async () => 42, {
        op: 'x',
      });

      expect(result).toBe(42);
      expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
        op: 'x',
      });
    });

    it('records duration even when the function throws', async () => {
      const histogram = getHistogram('hyperdx.test.duration');

      await expect(
        recordDuration(histogram, async () => {
          throw new Error('nope');
        }),
      ).rejects.toThrow('nope');

      expect(mockHistogram.record).toHaveBeenCalledWith(
        expect.any(Number),
        undefined,
      );
    });
  });

  describe('recordOperationOutcome', () => {
    it('emits the request counter and duration histogram with operation + outcome', () => {
      recordOperationOutcome({
        operation: 'test.op',
        outcome: 'success',
        durationMs: 12,
        attributes: { extra: 'x' },
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        extra: 'x',
        operation: 'test.op',
        outcome: 'success',
      });
      expect(mockHistogram.record).toHaveBeenCalledWith(12, {
        extra: 'x',
        operation: 'test.op',
        outcome: 'success',
      });
    });
  });

  describe('withOperationMetrics', () => {
    it('records a success outcome and returns the result', async () => {
      const result = await withOperationMetrics('test.op', async () => 'ok');

      expect(result).toBe('ok');
      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        operation: 'test.op',
        outcome: 'success',
      });
      expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
        operation: 'test.op',
        outcome: 'success',
      });
    });

    it('records an error outcome and rethrows', async () => {
      await expect(
        withOperationMetrics('test.op', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        operation: 'test.op',
        outcome: 'error',
      });
      expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
        operation: 'test.op',
        outcome: 'error',
      });
    });

    it('merges extra attributes into both signals', async () => {
      await withOperationMetrics('test.op', async () => undefined, {
        provider: 'anthropic',
      });

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'anthropic',
        operation: 'test.op',
        outcome: 'success',
      });
    });
  });
});
