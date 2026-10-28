import { vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';

import WorkOSAuthPage from '@/WorkOSAuthPage';

vi.mock('@/api', () => ({
  default: { useMe: () => ({ data: null, isLoading: false }) },
}));
vi.mock('@/LandingHeader', () => ({ default: () => null }));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, replace: vi.fn() }),
}));

it('starts Google login with the saved deep link without exposing a password form', async () => {
  window.sessionStorage.setItem('hdx-login-redirect-url', '/search?q=error');
  render(
    <MantineProvider>
      <WorkOSAuthPage />
    </MantineProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByRole('link', { name: 'Sign in with Google' }),
    ).toHaveAttribute(
      'href',
      '/api/auth/workos?returnTo=%2Fsearch%3Fq%3Derror',
    ),
  );
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  window.sessionStorage.clear();
});
