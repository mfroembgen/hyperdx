import { Button, Center, Loader } from '@mantine/core';

import api from './api';
import PasswordAuthPage from './PasswordAuthPage';
import WorkOSAuthPage from './WorkOSAuthPage';

export default function AuthPage({ action }: { action: 'register' | 'login' }) {
  const {
    data: installation,
    isLoading,
    isError,
    refetch,
  } = api.useInstallation();

  if (isLoading) {
    return (
      <Center mih="100vh">
        <Loader aria-label="Loading sign-in" />
      </Center>
    );
  }
  if (isError) {
    return (
      <Center mih="100vh">
        <Button variant="primary" onClick={() => void refetch()}>
          Retry sign-in
        </Button>
      </Center>
    );
  }

  return installation?.workosEnabled ? (
    <WorkOSAuthPage />
  ) : (
    <PasswordAuthPage action={action} />
  );
}
