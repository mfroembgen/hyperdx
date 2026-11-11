import React from 'react';
import { vi } from 'vitest';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';

import { DBSearchPage } from '@/DBSearchPage';

const mockRouterPush = vi.fn();
const mockSetSearchedConfig = vi.fn();
const mockSetDirectTraceId = vi.fn();
const mockSetAnalysisMode = vi.fn();
const mockSetIsLive = vi.fn();
const mockOnSearch = vi.fn();
const mockOnTimeRangeSelect = vi.fn();

let mockDirectTraceId: string | null = null;
let mockSearchedConfig: Record<string, any> = {};
let mockSources: any[] = [];
// When true, useSources() reports the list as still loading, so tests can
// exercise what the page does before and after the source list arrives.
let mockSourcesLoading = false;
let latestDirectTracePanelProps: Record<string, any> | null = null;

vi.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

vi.mock('next/router', () => ({
  __esModule: true,
  default: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

vi.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('nuqs', async () => {
  const actual = await vi.importActual<typeof import('nuqs')>('nuqs');
  return {
    ...actual,
    useQueryState: (key: string) => {
      switch (key) {
        case 'traceId':
          return [mockDirectTraceId, mockSetDirectTraceId];
        case 'mode':
          return ['results', mockSetAnalysisMode];
        case 'isLive':
          return [true, mockSetIsLive];
        case 'denoise':
          return [false, vi.fn()];
        default:
          return [null, vi.fn()];
      }
    },
    useQueryStates: () => [mockSearchedConfig, mockSetSearchedConfig],
  };
});

vi.mock('@/source', () => ({
  getEventBody: () => 'Body',
  getFirstTimestampValueExpression: () => 'Timestamp',
  useSources: () => ({
    data: mockSourcesLoading ? undefined : mockSources,
  }),
  useSource: ({ id }: { id?: string | null }) => ({
    data: mockSourcesLoading
      ? undefined
      : mockSources.find(source => source.id === id),
    isLoading: mockSourcesLoading,
  }),
}));

vi.mock('@/timeQuery', () => ({
  parseRelativeTimeQuery: () => [new Date(0), new Date(1)],
  parseTimeQuery: () => [new Date(0), new Date(1)],
  useDefaultTimeRange: () => [new Date(0), new Date(1)],
  useNewTimeQuery: () => ({
    isReady: true,
    searchedTimeRange: [
      new Date('2024-04-01T00:00:00.000Z'),
      new Date('2024-04-02T00:00:00.000Z'),
    ],
    onSearch: mockOnSearch,
    onTimeRangeSelect: mockOnTimeRangeSelect,
  }),
}));

vi.mock('@/savedSearch', () => ({
  useCreateSavedSearch: () => ({ mutate: vi.fn() }),
  useDeleteSavedSearch: () => ({ mutate: vi.fn() }),
  useSavedSearch: () => ({ data: undefined }),
  useUpdateSavedSearch: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/searchFilters', () => ({
  useSearchPageFilterState: () => ({
    filters: [],
    whereSuggestions: [],
    setFilterValue: vi.fn(),
    clearAllFilters: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChartConfig', () => ({
  useAliasMapFromChartConfig: () => ({ data: {} }),
}));

vi.mock('@/hooks/useExplainQuery', () => ({
  useExplainQuery: () => ({}),
}));

vi.mock('@/theme/ThemeProvider', () => ({
  useAppTheme: () => ({ themeName: 'hyperdx' }),
  useBrandDisplayName: () => 'HyperDX',
  usePageTitle: (page?: string) => (page ? `${page} - HyperDX` : 'HyperDX'),
}));

vi.mock('../hooks/useMetadata', async () => {
  const actualModule0 = await vi.importActual<
    typeof import('../hooks/useMetadata')
  >('../hooks/useMetadata');
  return {
    ...actualModule0,
    useTableMetadata: () => ({
      data: { sorting_key: 'Timestamp' },
      isLoading: false,
    }),
    useColumns: () => ({
      data: undefined,
      isLoading: false,
    }),
  };
});

vi.mock('../hooks/useSqlSuggestions', () => ({
  useSqlSuggestions: () => [],
}));

vi.mock('../components/Search/DirectTraceSidePanel', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    latestDirectTracePanelProps = props;
    return (
      <div data-testid="direct-trace-panel">
        <button onClick={() => props.onClose()}>close-trace</button>
        <button onClick={() => props.onSourceChange('trace-source')}>
          select-trace-source
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/DBSearchPageFilters', () => ({
  DBSearchPageFilters: () => <div />,
}));

vi.mock('@/components/DBTimeChart', () => ({
  DBTimeChart: () => <div />,
}));

vi.mock('@/components/ActiveFilterPills', () => ({
  ActiveFilterPills: () => <div />,
}));
vi.mock('@/components/ContactSupportText', () => ({
  ContactSupportText: () => <div />,
}));
vi.mock('@/components/FavoriteButton', () => ({
  FavoriteButton: () => <div />,
}));
vi.mock('@/components/InputControlled', () => ({
  InputControlled: () => <div />,
}));
vi.mock('@/components/OnboardingModal', () => ({ default: () => <div /> }));
vi.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => <div />,
  getStoredLanguage: () => 'lucene',
}));
vi.mock('@/components/SearchGroupBy/SearchGroupBySelect', () => ({
  SearchGroupBySelect: () => <div />,
}));
vi.mock('@/components/SearchPageActionBar', () => ({ default: () => <div /> }));
vi.mock('@/components/SearchTotalCountChart', () => ({
  default: () => <div />,
}));
vi.mock('@/components/Sources/SourceForm', () => ({
  TableSourceForm: () => <div />,
}));
vi.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => <div />,
}));
vi.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: () => <div />,
}));
vi.mock('@/components/Tags', () => ({
  Tags: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/TimePicker', () => ({
  TimePicker: () => <div />,
}));
vi.mock('../components/ChartSQLPreview', () => ({
  default: () => <div />,
  SQLPreview: () => <div />,
}));
vi.mock('../components/DBSqlRowTableWithSidebar', () => ({
  default: () => <div />,
}));
vi.mock('../components/PatternTable', () => ({ default: () => <div /> }));
vi.mock('../components/Search/DBSearchHeatmapChart', () => ({
  DBSearchHeatmapChart: () => <div />,
}));
vi.mock('../components/SourceSchemaPreview', () => ({
  __esModule: true,
  default: () => <div />,
  isSourceSchemaPreviewEnabled: () => false,
  getSourceSchemaTables: () => [],
}));
vi.mock('../components/Error/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('../utils/queryParsers', () => ({
  parseAsJsonEncoded: () => 'parseAsJsonEncoded',
  parseAsSortingStateString: {
    parse: () => null,
  },
  parseAsStringEncoded: 'parseAsStringEncoded',
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({
      data: { team: {} },
      isSuccess: true,
    }),
  },
  useCompleteOnboardingTask: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/utils', () => ({
  QUERY_LOCAL_STORAGE: 'query-local-storage',
  useLocalStorage: (_key: string, initialValue: unknown) => [
    initialValue,
    vi.fn(),
  ],
  usePrevious: (value: unknown) => value,
  useWindowSize: () => ({ width: 1200, height: 800 }),
}));

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  )),
  useIsFetching: () => 0,
}));

describe('DBSearchPage direct trace flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestDirectTracePanelProps = null;
    mockSourcesLoading = false;
    mockDirectTraceId = 'trace-123';
    mockSearchedConfig = {
      source: undefined,
      where: '',
      select: '',
      whereLanguage: undefined,
      filters: [],
      orderBy: '',
    };
    mockSources = [
      {
        id: 'trace-source',
        kind: SourceKind.Trace,
        name: 'Trace Source',
        traceIdExpression: 'TraceId',
        from: { databaseName: 'db', tableName: 'traces' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp',
        implicitColumnExpression: 'Body',
        connection: 'conn',
        logSourceId: 'log-source',
      },
      {
        id: 'log-source',
        kind: SourceKind.Log,
        name: 'Log Source',
        from: { databaseName: 'db', tableName: 'logs' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp',
        implicitColumnExpression: 'Body',
        connection: 'conn',
      },
    ];
  });

  it('opens the direct trace panel with no selected source when none is provided', async () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(latestDirectTracePanelProps).toEqual(
        expect.objectContaining({
          traceId: 'trace-123',
          traceSourceId: null,
        }),
      );
    });
  });

  it('applies a direct trace filter when a valid trace source is present', async () => {
    mockSearchedConfig = {
      ...mockSearchedConfig,
      source: 'trace-source',
    };
    window.history.pushState(
      {},
      '',
      '/search?traceId=trace-123&source=trace-source',
    );

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(mockSetSearchedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'trace-source',
          where: "TraceId = 'trace-123'",
          whereLanguage: 'sql',
          filters: [],
        }),
      );
    });
  });

  it('applies the default 14-day range only when from/to are absent', () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    expect(mockOnTimeRangeSelect).toHaveBeenCalled();

    vi.clearAllMocks();
    window.history.pushState({}, '', '/search?traceId=trace-123&from=1&to=2');

    renderWithMantine(<DBSearchPage />);

    expect(mockOnTimeRangeSelect).not.toHaveBeenCalled();
  });

  it('lets the direct trace panel update the selected source', async () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(screen.getByTestId('direct-trace-panel')).toBeInTheDocument();
    });

    screen.getByText('select-trace-source').click();

    expect(mockSetSearchedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'trace-source',
        where: "TraceId = 'trace-123'",
        whereLanguage: 'sql',
        filters: [],
      }),
    );
  });

  it('clears the direct trace mode when the panel closes', async () => {
    window.history.pushState({}, '', '/search?traceId=trace-123');

    renderWithMantine(<DBSearchPage />);

    await waitFor(() => {
      expect(screen.getByTestId('direct-trace-panel')).toBeInTheDocument();
    });

    screen.getByText('close-trace').click();

    expect(mockSetDirectTraceId).toHaveBeenCalledWith(null);
  });

  it('resolves a source *name* in the source param to its id', async () => {
    mockSearchedConfig = {
      ...mockSearchedConfig,
      source: 'Trace Source',
    };
    window.history.pushState(
      {},
      '',
      '/search?traceId=trace-123&source=Trace%20Source',
    );

    renderWithMantine(<DBSearchPage />);

    // The direct trace filter only applies once the param resolves to a real
    // trace source, so this asserts the name was resolved to its id.
    await waitFor(() => {
      expect(mockSetSearchedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'trace-source',
          where: "TraceId = 'trace-123'",
          whereLanguage: 'sql',
        }),
      );
    });
  });

  // Renders through the source-list load so the form's `source` value goes from
  // empty to the resolved ID, the way a cold page load does. A wrapper (rather
  // than renderWithMantine) is used so `rerender` keeps the provider tree, and
  // with it the page's own state and refs.
  async function renderThroughSourceLoad() {
    vi.useFakeTimers();
    const { rerender } = render(<DBSearchPage />, {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    mockSourcesLoading = false;
    await act(async () => {
      rerender(<DBSearchPage />);
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    vi.useRealTimers();
  }

  it('canonicalizes a source name to its id without touching the rest of the config', async () => {
    mockDirectTraceId = null;
    mockSourcesLoading = true;
    mockSearchedConfig = {
      source: 'Log Source',
      where: '',
      select: 'Timestamp, Body',
      whereLanguage: undefined,
      filters: [],
      orderBy: '',
    };
    window.history.pushState(
      {},
      '',
      '/search?source=Log%20Source&select=Timestamp%2C%20Body',
    );

    await renderThroughSourceLoad();

    // The name is replaced by its id, and nothing else: a source-switch would
    // have cleared select/orderBy/filters and submitted the whole config.
    expect(mockSetSearchedConfig).toHaveBeenCalledTimes(1);
    expect(mockSetSearchedConfig).toHaveBeenCalledWith({
      source: 'log-source',
    });
  });

  it('leaves the config alone when the param is already a source id', async () => {
    mockDirectTraceId = null;
    mockSourcesLoading = true;
    mockSearchedConfig = {
      source: 'log-source',
      where: '',
      select: 'Timestamp, Body',
      whereLanguage: undefined,
      filters: [],
      orderBy: '',
    };
    window.history.pushState(
      {},
      '',
      '/search?source=log-source&select=Timestamp%2C%20Body',
    );

    await renderThroughSourceLoad();

    expect(mockSetSearchedConfig).not.toHaveBeenCalled();
  });

  it('leaves an unresolvable source param alone instead of picking a default', async () => {
    mockDirectTraceId = null;
    mockSourcesLoading = true;
    mockSearchedConfig = {
      source: 'Deleted Source',
      where: '',
      select: '',
      whereLanguage: undefined,
      filters: [],
      orderBy: '',
    };
    window.history.pushState({}, '', '/search?source=Deleted%20Source');

    await renderThroughSourceLoad();

    // Neither the default-source effect nor the form fallback may overwrite a
    // link whose source no longer exists — the user gets a notification and an
    // empty source picker instead.
    expect(mockSetSearchedConfig).not.toHaveBeenCalled();
  });

  it('still selects a default source when there is no source param', async () => {
    mockDirectTraceId = null;
    mockSourcesLoading = true;
    mockSearchedConfig = {
      source: null,
      where: '',
      select: '',
      whereLanguage: undefined,
      filters: [],
      orderBy: '',
    };
    window.history.pushState({}, '', '/search');

    await renderThroughSourceLoad();

    expect(mockSetSearchedConfig).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'trace-source' }),
    );
  });

  it('submits on a saved search route without discarding the config the link carried', async () => {
    // On `/search/<savedSearchId>` the source is written to the URL by the
    // saved-search effect, so the form catches up to it on a cold load. The
    // submit still has to run — that is how a freshly loaded page pushes its
    // defaults into the search config — but it must not clear `select`, which a
    // bookmarked or refreshed link may carry (e.g. an unsaved tweak).
    mockDirectTraceId = null;
    mockSourcesLoading = true;
    mockSearchedConfig = {
      source: 'log-source',
      where: '',
      select: 'Timestamp, Body, lower(Body) as body_lower',
      whereLanguage: undefined,
      filters: [],
      orderBy: 'Timestamp DESC',
    };
    window.history.pushState(
      {},
      '',
      '/search/saved-1?source=log-source&select=Timestamp%2C%20Body%2C%20lower(Body)%20as%20body_lower&orderBy=Timestamp%20DESC',
    );

    await renderThroughSourceLoad();

    expect(mockSetSearchedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'log-source',
        select: 'Timestamp, Body, lower(Body) as body_lower',
        orderBy: 'Timestamp DESC',
      }),
    );
    // Nothing may land that empties them.
    for (const [config] of mockSetSearchedConfig.mock.calls) {
      expect(config).not.toMatchObject({ select: '' });
      expect(config).not.toMatchObject({ orderBy: '' });
    }
  });
});
