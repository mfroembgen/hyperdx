import { useMemo } from 'react';
import { Box, Card, Divider, Text } from '@mantine/core';

import api from '@/api';
import { type DeploymentShape } from '@/components/ClickStackOnboarding/installSnippets';
import McpInstallPanel from '@/components/ClickStackOnboarding/McpInstallPanel';

import McpOAuthSetup from './McpOAuthSetup';

/** Connect clients using the deployment's OAuth or personal-key authentication. */
export default function McpServerSection() {
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const { data: installation, isLoading: isLoadingInstallation } =
    api.useInstallation();
  const oauthEnabled = installation?.workosEnabled === true;

  const deployment = useMemo<DeploymentShape | null>(() => {
    if (!me?.accessKey) return null;
    return {
      apiUrl: `${window.location.origin}/api`,
      accessKey: me.accessKey,
    };
  }, [me]);

  if (
    isLoadingMe ||
    isLoadingInstallation ||
    !me ||
    (!oauthEnabled && !deployment)
  ) {
    return null;
  }

  return (
    <Box id="mcp_server" data-testid="mcp-server-section">
      <Text size="md">Connect your AI Agents</Text>
      <Divider my="md" />
      <Card>
        {oauthEnabled ? (
          <McpOAuthSetup endpoint={`${window.location.origin}/api/mcp`} />
        ) : deployment ? (
          <McpInstallPanel deployment={deployment} />
        ) : null}
      </Card>
    </Box>
  );
}
