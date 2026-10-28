import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Button, Center, Loader, Paper, Stack, Text } from '@mantine/core';
import { useMounted } from '@mantine/hooks';

import { usePageTitle } from './theme/ThemeProvider';
import api from './api';
import LandingHeader from './LandingHeader';

export default function WorkOSAuthPage() {
  const { data: me, isLoading } = api.useMe();
  const router = useRouter();
  const title = usePageTitle('Sign in');
  const mounted = useMounted();
  let loginUrl = '/api/auth/workos';

  useEffect(() => {
    if (me) void router.replace('/search');
  }, [me, router]);

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
        {isLoading || me ? (
          <Loader aria-label="Signing in" />
        ) : (
          <Paper p="xl" maw={420}>
            <Stack>
              <Text fw={600}>Sign in to HyperDX</Text>
              <Text size="sm">
                Use your Google account. Your administrator must have added this
                account to your HyperDX team.
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
        )}
      </Center>
    </>
  );
}
