import { useEffect, useState } from 'react';
import { vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

// Render the dynamic() wrapper's inner component. The page passes
// `async () => ServicesDashboardPage`, so the loader resolves asynchronously;
// hold the resolved component in state so its arrival triggers a re-render
// (a plain closure assignment would not, leaving the tree empty).
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>) => {
    const Wrapped = (props: any) => {
      const [Component, setComponent] = useState<React.ComponentType | null>(
        null,
      );
      useEffect(() => {
        let active = true;
        loader().then((mod: any) => {
          if (active) setComponent(() => mod?.default ?? mod);
        });
        return () => {
          active = false;
        };
      }, []);
      return Component ? <Component {...props} /> : null;
    };
    return Wrapped;
  },
}));

vi.mock('nuqs', () => {
  const noop = () => {};
  return {
    __esModule: true,
    parseAsString: { withDefault: () => ({}) },
    parseAsStringEnum: () => ({
      withDefault: (d: unknown) => ({ defaultValue: d }),
    }),
    useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => [
      parser?.defaultValue ?? null,
      noop,
    ],
    useQueryStates: () => [{}, noop],
  };
});

// Trivial stubs for the heavy tab children — the smoke test only needs the
// page shell to mount, not the chart-heavy tabs.
vi.mock('../HttpTab', () => ({
  __esModule: true,
  default: () => <div data-testid="http-tab-mock" />,
  EndpointLatencyChart: () => null,
}));
vi.mock('../DatabaseTab', () => ({
  __esModule: true,
  default: () => <div data-testid="database-tab-mock" />,
}));
vi.mock('../ErrorsTab', () => ({
  __esModule: true,
  default: () => <div data-testid="errors-tab-mock" />,
}));

// Side panels + modal + onboarding pull in networked hooks; stub them out.
vi.mock('@/components/ServiceDashboardEndpointSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/ServiceDashboardDbQuerySidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/OnboardingModal', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/DashboardFilters', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/DashboardFiltersModal', () => ({
  __esModule: true,
  default: () => null,
}));

// Header input controls pull in networked editors / hooks; stub them out.
vi.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => null,
  getStoredLanguage: () => 'sql',
}));
vi.mock('@/components/SourceSelect', () => ({
  __esModule: true,
  SourceSelectControlled: () => null,
}));
vi.mock('@/components/SelectControlled', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/components/TimePicker', () => ({
  __esModule: true,
  TimePicker: () => null,
}));

vi.mock('@/hooks/usePresetDashboardFilters', () => ({
  __esModule: true,
  default: () => ({
    filters: [],
    filterValues: {},
    setFilterValue: vi.fn(),
    filterQueries: [],
    handleSaveFilter: vi.fn(),
    handleRemoveFilter: vi.fn(),
    isFetching: false,
    isMutationPending: false,
  }),
}));

vi.mock('@/source', () => ({
  __esModule: true,
  useSource: () => ({ data: undefined }),
  useSources: () => ({ data: [] }),
}));

vi.mock('@/serviceDashboard', () => ({
  __esModule: true,
  useServiceDashboardExpressions: () => ({ expressions: undefined }),
  getExpressions: () => ({}),
}));

vi.mock('@/timeQuery', () => ({
  __esModule: true,
  parseTimeQuery: () => [new Date(0), new Date(1)],
  useDefaultTimeRange: () => [new Date(0), new Date(1)],
  useNewTimeQuery: () => ({
    searchedTimeRange: [new Date(0), new Date(1)],
    onSearch: vi.fn(),
    onTimeRangeSelect: vi.fn(),
  }),
}));

vi.mock('@/hooks/useDashboardRefresh', () => ({
  __esModule: true,
  useDashboardRefresh: () => ({
    manualRefreshCooloff: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChartConfig', () => ({
  __esModule: true,
  useQueriedChartConfig: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/layout', () => ({
  __esModule: true,
  withAppNav: (page: unknown) => page,
  withAppNavForSurface: () => (page: unknown) => page,
}));

vi.mock('@/theme/ThemeProvider', () => ({
  __esModule: true,
  useBrandDisplayName: () => 'HyperDX',
  usePageTitle: (page?: string) => (page ? `${page} - HyperDX` : 'HyperDX'),
}));

import ServicesDashboardPage from '@/ServicesDashboardPage';

describe('ServicesDashboardPage', () => {
  it('renders the page shell', async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ServicesDashboardPage />
        </MantineProvider>
      </QueryClientProvider>,
    );

    // The dynamic() wrapper resolves the page component asynchronously, so
    // wait for the shell to mount rather than asserting synchronously.
    await waitFor(() =>
      expect(screen.getByTestId('services-dashboard-page')).toBeInTheDocument(),
    );
  });
});
