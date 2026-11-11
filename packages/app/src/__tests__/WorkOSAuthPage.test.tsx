import { vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';

import WorkOSAuthPage from '@/WorkOSAuthPage';

const mocks = vi.hoisted(() => ({
  useMe: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/api', () => ({
  default: { useMe: mocks.useMe },
}));
vi.mock('@/LandingHeader', () => ({ default: () => null }));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, replace: mocks.replace }),
}));

beforeEach(() => {
  mocks.useMe.mockClear();
  mocks.useMe.mockReturnValue({ data: null, isLoading: false });
  mocks.replace.mockClear();
});

it.each([
  ['pending identity request', { data: undefined, isLoading: true }],
  [
    'stale identity after logout',
    {
      data: { email: 'member@example.invalid' },
      isLoading: false,
      isError: true,
    },
  ],
])('keeps Google sign-in available with a %s', (_name, identity) => {
  mocks.useMe.mockReturnValue(identity);
  render(
    <MantineProvider>
      <WorkOSAuthPage />
    </MantineProvider>,
  );

  expect(
    screen.getByRole('link', { name: 'Sign in with Google' }),
  ).toHaveAttribute('href', '/api/auth/workos');
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.useMe).not.toHaveBeenCalled();
});

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
