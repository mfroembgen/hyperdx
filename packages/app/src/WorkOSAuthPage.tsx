import Head from 'next/head';
import { useRouter } from 'next/router';
import { Button, Center, Paper, Stack, Text } from '@mantine/core';
import { useMounted } from '@mantine/hooks';

import { usePageTitle } from './theme/ThemeProvider';
import LandingHeader from './LandingHeader';

export default function WorkOSAuthPage() {
  const router = useRouter();
  const title = usePageTitle('Sign in');
  const mounted = useMounted();
  let loginUrl = '/api/auth/workos';

  if (mounted) {
    try {
      const returnTo = window.sessionStorage.getItem('hdx-login-redirect-url');
      if (returnTo?.startsWith('/') && !/^[/\\]{2}|\\/.test(returnTo)) {
        loginUrl = `/api/auth/workos?returnTo=${encodeURIComponent(returnTo)}`;
      }
    } catch {
      // Browser storage is optional; the server defaults to Search.
    }
  }

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <LandingHeader activeKey="/login" fixed />
      <Center mih="100vh">
        <Paper p="xl" maw={420}>
          <Stack>
            <Text fw={600}>Sign in to HyperDX</Text>
            <Text size="sm">
              Sign in with your Google account to access your HyperDX team.
            </Text>
            {router.query.err && (
              <Text size="sm" c="red" role="alert">
                Sign-in could not be completed. Try again with an account that
                belongs to this team, or contact your administrator.
              </Text>
            )}
            <Button component="a" href={loginUrl} variant="primary">
              Sign in with Google
            </Button>
          </Stack>
        </Paper>
      </Center>
    </>
  );
}
