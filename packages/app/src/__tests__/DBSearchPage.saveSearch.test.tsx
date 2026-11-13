import React from 'react';
import { vi } from 'vitest';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DBSearchPage } from '@/DBSearchPage';

const mockRouterPush = vi.fn();
const mockSetSearchedConfig = vi.fn().mockResolvedValue(new URLSearchParams());
const mockCreateSavedSearch = vi.fn();

let mockSearchedConfig: Record<string, any> = {};
let mockSources: any[] = [];

vi.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

vi.mock('next/router', () => ({
  __esModule: true,
  default: {
    basePath: '/clickstack',
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

vi.mock('nuqs', () => {
  // Chainable stand-in: the page only hands parsers to the mocked hooks.
  const parser = { withDefault: () => parser, withOptions: () => parser };
  return {
    parseAsBoolean: parser,
    parseAsInteger: parser,
    parseAsString: parser,
    parseAsStringEnum: () => parser,
    useQueryState: (key: string) => {
      switch (key) {
        case 'isLive':
          return [true, vi.fn()];
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
  useSources: () => ({ data: mockSources }),
  useSource: ({ id }: { id?: string | null }) => ({
    data: mockSources.find(source => source.id === id),
    isLoading: false,
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
    onSearch: vi.fn(),
    onTimeRangeSelect: vi.fn(),
  }),
}));

vi.mock('@/savedSearch', () => ({
  useCreateSavedSearch: () => ({
    mutateAsync: (...args: unknown[]) => mockCreateSavedSearch(...args),
    isPending: false,
  }),
  useDeleteSavedSearch: () => ({ mutate: vi.fn() }),
  useSavedSearch: () => ({ data: undefined }),
  useUpdateSavedSearch: () => ({ mutate: vi.fn(), isPending: false }),
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

vi.mock('@/brand', () => ({
  useBrandDisplayName: () => 'ClickStack',
  usePageTitle: (page?: string) =>
    page ? `${page} - ClickStack` : 'ClickStack',
}));

vi.mock('../hooks/useMetadata', async () => ({
  ...(await vi.importActual<typeof import('../hooks/useMetadata')>(
    '../hooks/useMetadata',
  )),
  useTableMetadata: () => ({
    data: { sorting_key: 'Timestamp' },
    isLoading: false,
  }),
  useColumns: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../hooks/useSqlSuggestions', () => ({
  useSqlSuggestions: () => [],
}));

vi.mock('../components/Search/DirectTraceSidePanel', () => ({
  __esModule: true,
  default: () => <div />,
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
  parseAsSortingStateString: { parse: () => null },
  parseAsStringEncoded: 'parseAsStringEncoded',
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({ data: { team: {} }, isSuccess: true }),
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

vi.mock('@tanstack/react-query', () => ({
  useIsFetching: () => 0,
}));

describe('DBSearchPage save search flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSavedSearch.mockResolvedValue({ id: 'new-saved-search' });
    mockSearchedConfig = {
      source: 'log-source',
      where: 'level:error',
      select: 'Timestamp, Body',
      whereLanguage: 'lucene',
      filters: [],
      orderBy: 'Timestamp DESC',
    };
    mockSources = [
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
    window.history.pushState({}, '', '/search?from=100&to=200&isLive=false');
  });

  async function saveSearchAs(name: string) {
    const user = userEvent.setup();
    render(<DBSearchPage />, {
      wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
    });

    await user.click(await screen.findByTestId('save-search-button'));
    await user.type(await screen.findByTestId('save-search-name-input'), name);
    await user.click(screen.getByTestId('save-search-submit-button'));
  }

  // The route is pushed through the router rather than assigned to
  // window.location: a document navigation reloads the whole app, and 404s on
  // the static ClickStack export, where /search/<id> has no exported document.
  // basePath is left off because the router prepends it.
  it('navigates to the new saved search client-side', async () => {
    await saveSearchAs('Errors');

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        '/search/new-saved-search?from=100&to=200&isLive=false',
      );
    });
  });

  it('drains queued query-string updates before navigating', async () => {
    await saveSearchAs('Errors');

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    // nuqs flushes its queue onto whatever path the router reports, so a write
    // still queued when the transition starts would land back on /search.
    expect(mockSetSearchedConfig).toHaveBeenCalledWith({});
    expect(mockSetSearchedConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockRouterPush.mock.invocationCallOrder[0],
    );
  });
});
