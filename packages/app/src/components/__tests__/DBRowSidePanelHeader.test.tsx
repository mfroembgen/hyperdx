import React from 'react';
import { vi } from 'vitest';
import { screen } from '@testing-library/react';

import DBRowSidePanelHeader from '@/components/DBRowSidePanelHeader';

// Stub modules that touch user preferences, AI APIs, or DOM observers; the
// behavior under test is the body-paper visibility logic, not those deps.
vi.mock('@/useUserPreferences', () => ({
  useUserPreferences: vi.fn().mockReturnValue({
    userPreferences: { expandSidebarHeader: false },
    setUserPreference: vi.fn(),
  }),
}));

vi.mock('@/useFormatTime', () => ({
  FormatTime: () => null,
}));

vi.mock('../AISummarizeButton', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../DBHighlightedAttributesList', () => ({
  DBHighlightedAttributesList: () => null,
}));

vi.mock('../DBRowSidePanel', () => ({
  RowSidePanelContext: React.createContext({}),
}));

vi.mock('../DrawerUtils', () => ({
  DrawerFullWidthToggle: () => null,
}));

vi.mock('../LogLevel', () => ({
  __esModule: true,
  default: () => null,
}));

describe('DBRowSidePanelHeader: body section (HDX-4373)', () => {
  it('renders the configured body content when bodyConfigured + mainContent are truthy', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent="hello world"
        mainContentHeader="Body"
        bodyConfigured
      />,
    );
    expect(screen.queryByText('hello world')).toBeInTheDocument();
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('[Empty]')).not.toBeInTheDocument();
  });

  it('renders the softened empty state when body is configured but value is empty', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader="Body"
        bodyConfigured
      />,
    );
    expect(screen.queryByText('No body for this event.')).toBeInTheDocument();
    expect(screen.queryByText('[Empty]')).not.toBeInTheDocument();
  });

  it('suppresses the body paper entirely when body is not configured on the source', () => {
    renderWithMantine(
      <DBRowSidePanelHeader
        mainContent=""
        mainContentHeader=""
        bodyConfigured={false}
      />,
    );
    expect(
      screen.queryByText('No body for this event.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('[Empty]')).not.toBeInTheDocument();
  });

  it('defaults bodyConfigured to true (back-compat with callers that do not pass it)', () => {
    renderWithMantine(<DBRowSidePanelHeader mainContent="" />);
    expect(screen.queryByText('No body for this event.')).toBeInTheDocument();
  });
});
