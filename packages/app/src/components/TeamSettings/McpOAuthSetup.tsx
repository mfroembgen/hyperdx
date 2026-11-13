import { Stack, Text } from '@mantine/core';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';

export default function McpOAuthSetup({ endpoint }: { endpoint: string }) {
  return (
    <Stack>
      <Text size="sm">
        Connect with your organization’s Google login. Your client opens the
        browser to sign in; no personal access key is needed.
      </Text>
      <CopySnippet
        label="Codex"
        snippet={`codex mcp add clickstack --url ${endpoint}\ncodex mcp login clickstack`}
      />
      <CopySnippet
        label="Claude Code"
        snippet={`claude mcp add --transport http clickstack ${endpoint}`}
      />
      <Text size="sm">
        In Claude Code, open /mcp to sign in. In Claude’s connector settings,
        add this URL:
      </Text>
      <CopySnippet snippet={endpoint} />
    </Stack>
  );
}
