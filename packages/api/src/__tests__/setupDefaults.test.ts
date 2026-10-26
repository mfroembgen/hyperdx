import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { vi } from 'vitest';

const configState = { IS_PROMQL_ENABLED: false };

vi.mock('@/config', () => ({
  DEFAULT_CONNECTIONS: undefined,
  DEFAULT_SOURCES: JSON.stringify([
    {
      kind: SourceKind.Log as const,
      name: 'Logs',
      connection: 'Local ClickHouse',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: 'Timestamp, Body',
    },
    {
      kind: SourceKind.Promql as const,
      name: 'PromQL',
      connection: 'Local ClickHouse',
      from: { databaseName: 'default', tableName: 'metrics_ts' },
      timestampValueExpression: 'timestamp',
    },
  ]),
  get IS_PROMQL_ENABLED() {
    return configState.IS_PROMQL_ENABLED;
  },
}));

vi.mock('@/controllers/team', () => ({
  getTeam: vi.fn().mockResolvedValue({ _id: 'team-1' }),
}));
vi.mock('@/controllers/connection', () => ({
  createConnection: vi.fn(),
  getConnections: vi
    .fn()
    .mockResolvedValue([
      { _id: 'conn-1', team: 'team-1', name: 'Local ClickHouse' },
    ]),
}));
vi.mock('@/controllers/sources', () => ({
  getSources: vi.fn().mockResolvedValue([]),
  createSource: vi.fn(async (_teamId: string, source: { name: string }) => ({
    _id: `${source.name}-id`,
    toObject: () => source,
  })),
  updateSource: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createSource } from '@/controllers/sources';
import { setupTeamDefaults } from '@/setupDefaults';

const createdKinds = () =>
  vi.mocked(createSource).mock.calls.map(([, source]) => source.kind);

describe('setupTeamDefaults', () => {
  beforeEach(() => {
    vi.mocked(createSource).mockClear();
  });

  it('creates a default PromQL source when PromQL is enabled', async () => {
    configState.IS_PROMQL_ENABLED = true;

    await setupTeamDefaults('team-1');

    expect(createdKinds()).toEqual([SourceKind.Log, SourceKind.Promql]);
    expect(createSource).toHaveBeenLastCalledWith(
      'team-1',
      expect.objectContaining({
        kind: SourceKind.Promql as const,
        connection: 'conn-1',
        from: { databaseName: 'default', tableName: 'metrics_ts' },
      }),
    );
  });

  it('skips a default PromQL source when PromQL is disabled', async () => {
    configState.IS_PROMQL_ENABLED = false;

    await setupTeamDefaults('team-1');

    expect(createdKinds()).toEqual([SourceKind.Log]);
  });
});
