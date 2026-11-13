import React from 'react';
import { vi } from 'vitest';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';

vi.mock('nuqs', async () => {
  const actual = await vi.importActual<typeof import('nuqs')>('nuqs');
  return {
    ...actual,
    useQueryState: (_key: string, parser?: { defaultValue?: unknown }) => [
      parser && 'defaultValue' in parser ? parser.defaultValue : null,
      vi.fn(),
    ],
  };
});

const mockRow: { current: Record<string, unknown> } = { current: {} };
vi.mock('../DBRowDataPanel', () => ({
  __esModule: true,
  useRowData: () => ({
    data: { data: [mockRow.current] },
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
  }),
  ROW_DATA_ALIASES: {
    DURATION_MS: '__hdx_duration',
    SPAN_KIND: '__hdx_span_kind',
    SERVICE_NAME: '__hdx_service_name',
    SEVERITY_TEXT: '__hdx_severity_text',
    EVENT_NAME: '__hdx_event_name',
    EVENT_ATTRIBUTES: '__hdx_event_attributes',
  },
  rowHasK8sContext: () => false,
  RowDataPanel: () => null,
}));

const mockHeaderProps: { current: { hideEmptyBody?: boolean } } = {
  current: {},
};
vi.mock('../DBRowSidePanelHeader', () => ({
  __esModule: true,
  default: (props: { hideEmptyBody?: boolean }) => {
    mockHeaderProps.current = props;
    return null;
  },
}));

vi.mock('@/source', () => ({
  __esModule: true,
  getEventBody: () => '__hdx_body',
  useSource: () => ({ data: undefined }),
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
vi.mock('../SidePanelBreadcrumbs', () => ({
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

// Imported after the mock factories above.
import { DBRowSidePanelInner } from '@/components/DBRowSidePanel';
import useSidePanelStack from '@/hooks/useSidePanelStack';
import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';

const LOG_SOURCE = makeLogSource();
const TRACE_SOURCE = makeTraceSource();

function Harness({ source }: { source: TSource }) {
  const sidePanelStack = useSidePanelStack({ initialRowId: 'row-1' });
  return (
    <DBRowSidePanelInner
      source={source}
      rowId="row-1"
      aliasWith={[]}
      onClose={vi.fn()}
      sidePanelStack={sidePanelStack}
    />
  );
}

function hideEmptyBodyFor(source: TSource, row: Record<string, unknown>) {
  mockRow.current = { __hdx_body: '', ...row };
  render(
    <MantineProvider>
      <Harness source={source} />
    </MantineProvider>,
  );
  return mockHeaderProps.current.hideEmptyBody;
}

describe('DBRowSidePanelInner, empty body on browser event rows', () => {
  beforeEach(() => {
    mockHeaderProps.current = {};
  });

  // Only the event name identifies a resource timing row; it has no detection
  // keys for the attribute fallback to find.
  it('hides it on a log row the event name marks as a browser event', () => {
    expect(
      hideEmptyBodyFor(LOG_SOURCE, {
        __hdx_event_name: 'browser.resource_timing',
        __hdx_event_attributes: { 'url.full': 'https://example.com/app.js' },
      }),
    ).toBe(true);
  });

  it('keeps it on a log row with no browser event name or keys', () => {
    expect(
      hideEmptyBodyFor(LOG_SOURCE, {
        __hdx_event_name: '',
        __hdx_event_attributes: { 'http.route': '/api' },
      }),
    ).toBe(false);
  });

  it('keeps it on a trace row that carries click keys', () => {
    expect(
      hideEmptyBodyFor(TRACE_SOURCE, {
        __hdx_event_attributes: { 'browser.tag_name': 'BUTTON' },
      }),
    ).toBe(false);
  });
});
