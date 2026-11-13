import { type Mock, vi } from 'vitest';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

// Controlled stand-in for nuqs. Values are the parsed shapes the panel reads.
// Prefixed with `mock` so the hoisted vi.mock factory can close over them.
const mockQueryStore: Record<string, unknown> = {};
const mockSetters: Record<string, Mock> = {};

function seedParam(key: string, value: unknown) {
  mockQueryStore[key] = value;
}
function setterFor(key: string) {
  if (!mockSetters[key]) mockSetters[key] = vi.fn();
  return mockSetters[key];
}
function resetQueryState() {
  Object.keys(mockQueryStore).forEach(k => delete mockQueryStore[k]);
  Object.keys(mockSetters).forEach(k => delete mockSetters[k]);
}

vi.mock('nuqs', async () => {
  const actualModule0 = await vi.importActual<typeof import('nuqs')>('nuqs');

  const actual = actualModule0;
  return {
    ...actual,
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
      const hasValue = Object.prototype.hasOwnProperty.call(
        mockQueryStore,
        key,
      );
      const fallback =
        parser && 'defaultValue' in parser ? parser.defaultValue : null;
      const value = hasValue ? mockQueryStore[key] : (fallback ?? null);
      const setters = mockSetters;
      if (!setters[key]) setters[key] = vi.fn();
      return [value, setters[key]];
    },
  };
});

vi.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: () => ({
    data: undefined,
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  ROW_DATA_ALIASES: {
    DURATION_MS: '__hdx_duration',
    SPAN_KIND: '__hdx_span_kind',
    SERVICE_NAME: '__hdx_service_name',
    SEVERITY_TEXT: '__hdx_severity_text',
  },
  rowHasK8sContext: () => false,
  RowDataPanel: () => null,
}));

vi.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => '__hdx_body',
  useSource: () => ({ data: undefined, isLoading: false, isSuccess: false }),
}));

vi.mock('../DBSessionPanel', () => ({
  __esModule: true,
  useSessionId: () => ({ rumSessionId: undefined, rumServiceName: undefined }),
  DBSessionPanel: () => null,
}));

vi.mock('@/utils/highlightedAttributes', () => ({
  __esModule: true,
  getHighlightedAttributesFromData: () => [],
}));

vi.mock('../DBTracePanel', () => ({ __esModule: true, default: () => null }));
vi.mock('../ContextSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('../DBInfraPanel', () => ({ __esModule: true, default: () => null }));
vi.mock('../DBRowOverviewPanel', () => ({
  __esModule: true,
  RowOverviewPanel: () => null,
}));
vi.mock('../DBRowSidePanelErrorState', () => ({
  __esModule: true,
  DBRowSidePanelErrorState: () => null,
}));
vi.mock('../DBRowSidePanelHeader', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('../LogLevel', () => ({ __esModule: true, default: () => null }));
vi.mock('../ServiceMap/ServiceMapSidePanel', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('../TimelineChart/utils', () => ({
  __esModule: true,
  renderMs: () => '',
}));
vi.mock('../DrawerUtils', () => ({
  __esModule: true,
  DrawerFullWidthToggle: () => null,
  INITIAL_DRAWER_WIDTH_PERCENT: 50,
}));
vi.mock('@/LogSidePanelElements', () => ({
  __esModule: true,
  KeyboardShortcutsModal: () => null,
}));
vi.mock('@/TabBar', () => ({ __esModule: true, default: () => null }));
vi.mock('@/useFormatTime', () => ({
  __esModule: true,
  FormatTime: () => null,
}));

import DBRowSidePanelErrorBoundary, {
  DBRowSidePanelInner,
} from '@/components/DBRowSidePanel';
import useSidePanelStack from '@/hooks/useSidePanelStack';

const ROOT_SOURCE: TLogSource = {
  id: 'log-src',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  traceSourceId: 'trace-src',
};

const urlSpan = {
  id: 'span-where',
  type: 'trace',
  aliasWith: [],
  traceId: 'trace-1',
};

function renderBoundary(rowId: string) {
  return render(
    <MantineProvider>
      <DBRowSidePanelErrorBoundary
        source={ROOT_SOURCE}
        rowId={rowId}
        aliasWith={[]}
        onClose={vi.fn()}
      />
    </MantineProvider>,
  );
}

function InnerHarness({
  rowId,
  onClose,
  onNavigateToParent,
  parentBreadcrumbs,
}: {
  rowId: string;
  onClose: () => void;
  onNavigateToParent?: () => void;
  parentBreadcrumbs?: { label: string; onClick?: () => void }[];
}) {
  const sidePanelStack = useSidePanelStack({ initialRowId: rowId });
  return (
    <DBRowSidePanelInner
      source={ROOT_SOURCE}
      rowId={rowId}
      aliasWith={[]}
      onClose={onClose}
      onNavigateToParent={onNavigateToParent}
      parentBreadcrumbs={parentBreadcrumbs}
      sidePanelStack={sidePanelStack}
    />
  );
}

describe('DBRowSidePanelErrorBoundary span selection', () => {
  beforeEach(() => {
    resetQueryState();
    seedParam('eventRowWhere', urlSpan);
  });

  it('keeps an eventRowWhere that arrived with the URL on the first render', () => {
    renderBoundary('row-a');

    expect(setterFor('eventRowWhere')).not.toHaveBeenCalled();
  });

  it('clears the span when the opened row changes', () => {
    const view = renderBoundary('row-a');

    view.rerender(
      <MantineProvider>
        <DBRowSidePanelErrorBoundary
          source={ROOT_SOURCE}
          rowId="row-b"
          aliasWith={[]}
          onClose={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
  });

  it('clears the span when the drawer closes', () => {
    renderBoundary('row-a');

    fireEvent.click(screen.getByLabelText('Close'));

    expect(setterFor('eventRowWhere')).toHaveBeenCalledTimes(1);
    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
  });

  it('clears the span when leaving an embedded event for its parent', () => {
    const onNavigateToParent = vi.fn();
    render(
      <MantineProvider>
        <InnerHarness
          rowId="row-a"
          onClose={vi.fn()}
          onNavigateToParent={onNavigateToParent}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByLabelText('Back'));

    expect(setterFor('eventRowWhere')).toHaveBeenCalledTimes(1);
    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
    expect(onNavigateToParent).toHaveBeenCalled();
  });

  it('clears the span when the session breadcrumb is clicked', () => {
    const onSessionClick = vi.fn();
    render(
      <MantineProvider>
        <InnerHarness
          rowId="row-a"
          onClose={vi.fn()}
          parentBreadcrumbs={[{ label: 'Session', onClick: onSessionClick }]}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByTestId('side-panel-breadcrumb-0'));

    expect(setterFor('eventRowWhere')).toHaveBeenCalledTimes(1);
    expect(setterFor('eventRowWhere')).toHaveBeenCalledWith(null);
    expect(onSessionClick).toHaveBeenCalled();
  });
});
