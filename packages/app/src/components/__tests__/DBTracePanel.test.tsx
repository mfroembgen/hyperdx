import React from 'react';
import { vi } from 'vitest';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen } from '@testing-library/react';

import { RowSidePanelContext } from '@/components/DBRowSidePanel';
import DBTracePanel from '@/components/DBTracePanel';

let mockSources: Record<string, any> = {};
// Controls the value returned by the mocked `useQueryState('eventRowWhere')`
// so tests can render with or without a selected span. Prefixed with `mock` so
// the hoisted vi.mock factory may reference it.
let mockEventRowWhere: any = null;

vi.mock('nuqs', () => ({
  useQueryState: () => [mockEventRowWhere, vi.fn()],
}));

vi.mock('@/utils/queryParsers', () => ({
  parseAsJsonEncoded: () => 'parseAsJsonEncoded',
}));

vi.mock('@/source', () => ({
  useSource: ({ id }: { id?: string | null }) => ({
    data: id ? mockSources[id] : undefined,
    isLoading: false,
  }),
  useUpdateSource: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock('@/components/DBTraceWaterfallChart', () => ({
  DBTraceWaterfallChartContainer: ({
    emptyState,
    controlsExtra,
  }: {
    emptyState?: React.ReactNode;
    controlsExtra?: React.ReactNode;
  }) => (
    <div>
      {controlsExtra}
      {emptyState ?? 'waterfall'}
    </div>
  ),
}));

vi.mock('../SourceSelect', () => ({
  SourceSelectControlled: () => <div>source select</div>,
}));

// useRowData runs unconditionally (for the Infrastructure tab / k8s detection)
// and would otherwise need a QueryClient provider; stub it for this unit test.
vi.mock('../DBRowDataPanel', () => ({
  useRowData: () => ({ data: undefined }),
  rowHasK8sContext: () => false,
  RowDataPanel: () => <div>row data panel</div>,
}));

// Stands in for the real overview panel but still consumes the (real)
// RowSidePanelContext, so the tests below can observe the source-aware
// context SpanDetailPanel derives for the selected event (HDX-5040).
vi.mock('../DBRowOverviewPanel', async () => {
  const actualModule0 = await vi.importActual<typeof import('react')>('react');
  const actualModule1 =
    await vi.importActual<typeof import('../DBRowSidePanel')>(
      '../DBRowSidePanel',
    );
  return {
    RowOverviewPanel: () => {
      const ReactActual = actualModule0;
      // Required lazily so the circular DBTracePanel <-> DBRowSidePanel import
      // is fully initialized by render time.
      const { RowSidePanelContext: Ctx } = actualModule1;
      const ctx = ReactActual.use(Ctx);
      return (
        <div>
          <div>overview panel</div>
          <button
            onClick={() =>
              ctx.generateSearchUrl?.({ where: 'x', whereLanguage: 'sql' })
            }
          >
            generate search url
          </button>
          <div data-testid="can-add-to-filters">
            {ctx.onPropertyAddClick ? 'yes' : 'no'}
          </div>
        </div>
      );
    },
  };
});

vi.mock('../DBInfraPanel', () => ({
  __esModule: true,
  default: () => <div>infra panel</div>,
}));

vi.mock('../SourceSchemaPreview', () => ({
  __esModule: true,
  default: () => <div />,
  isSourceSchemaPreviewEnabled: () => false,
  getSourceSchemaTables: () => [],
}));

describe('DBTracePanel', () => {
  beforeEach(() => {
    mockEventRowWhere = null;
    mockSources = {
      'trace-source': {
        id: 'trace-source',
        kind: SourceKind.Trace,
        traceIdExpression: 'TraceId',
        logSourceId: 'log-source',
      },
      'log-source': {
        id: 'log-source',
        kind: SourceKind.Log,
        traceIdExpression: 'TraceId',
      },
    };
  });

  it('passes through a custom empty state to the waterfall container', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
        emptyState={<div>Trace not found</div>}
      />,
    );

    expect(screen.getByText('Trace not found')).toBeInTheDocument();
  });

  it('moves the correlated logs source selector into the waterfall controls', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
      />,
    );

    // The selector (mocked) now renders inside the waterfall controls bar.
    expect(screen.getByText('source select')).toBeInTheDocument();
    expect(screen.getByText('Correlated logs')).toBeInTheDocument();
  });

  it('does not duplicate the trace id in the panel body', () => {
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
      />,
    );

    // Trace id lives in the side-panel header now, not the trace panel body.
    expect(screen.queryByText(/trace-123/)).not.toBeInTheDocument();
  });

  it('toggles the span detail layout and persists the choice', () => {
    localStorage.clear();
    mockEventRowWhere = {
      id: 'span-1',
      type: SourceKind.Trace,
      aliasWith: [],
      traceId: 'trace-123',
    };
    renderWithMantine(
      <DBTracePanel
        traceId="trace-123"
        parentSourceId="trace-source"
        childSourceId="log-source"
        dateRange={[new Date(0), new Date(1000)]}
        focusDate={new Date(500)}
      />,
    );

    const toggle = screen.getByTestId('trace-detail-layout-toggle');

    // Default 'side' layout: the control offers switching to the bottom layout.
    expect(
      toggle.querySelector('.tabler-icon-layout-bottombar'),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    // Now in 'bottom' layout: the control offers switching back to the side.
    expect(
      toggle.querySelector('.tabler-icon-layout-sidebar-right'),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('hdx_trace_detail_layout')!)).toBe(
      'bottom',
    );

    fireEvent.click(toggle);
    // Back to 'side'; leave the shared atom at its default for other tests.
    expect(
      toggle.querySelector('.tabler-icon-layout-bottombar'),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('hdx_trace_detail_layout')!)).toBe(
      'side',
    );
  });

  // The searched source is the trace source; the selected waterfall event may
  // belong to the correlated log source. Search urls must target the event's
  // own source, and filter actions (which mutate the searched source's query)
  // must be gated off for cross-source events.
  describe('span detail context for the selected event', () => {
    const renderWithSearchContext = () => {
      const generateSearchUrl = vi.fn(() => '/search?mock');
      const onPropertyAddClick = vi.fn();
      renderWithMantine(
        <RowSidePanelContext
          value={{
            generateSearchUrl,
            onPropertyAddClick,
            source: mockSources['trace-source'],
          }}
        >
          <DBTracePanel
            traceId="trace-123"
            parentSourceId="trace-source"
            childSourceId="log-source"
            dateRange={[new Date(0), new Date(1000)]}
            focusDate={new Date(500)}
          />
        </RowSidePanelContext>,
      );
      return { generateSearchUrl, onPropertyAddClick };
    };

    it('targets the log source for a selected log event and gates filter actions', () => {
      mockEventRowWhere = {
        id: 'log-1',
        type: SourceKind.Log,
        aliasWith: [],
        traceId: 'trace-123',
      };
      const { generateSearchUrl } = renderWithSearchContext();

      fireEvent.click(screen.getByText('generate search url'));
      expect(generateSearchUrl).toHaveBeenCalledWith({
        where: 'x',
        whereLanguage: 'sql',
        source: expect.objectContaining({ id: 'log-source' }),
      });

      // "Add to Filters" would inject log columns into the trace search.
      expect(screen.getByTestId('can-add-to-filters')).toHaveTextContent('no');
    });

    it('keeps the searched source and filter actions for a selected span', () => {
      mockEventRowWhere = {
        id: 'span-1',
        type: SourceKind.Trace,
        aliasWith: [],
        traceId: 'trace-123',
      };
      const { generateSearchUrl } = renderWithSearchContext();

      fireEvent.click(screen.getByText('generate search url'));
      expect(generateSearchUrl).toHaveBeenCalledWith({
        where: 'x',
        whereLanguage: 'sql',
        source: expect.objectContaining({ id: 'trace-source' }),
      });

      expect(screen.getByTestId('can-add-to-filters')).toHaveTextContent('yes');
    });
  });
});
