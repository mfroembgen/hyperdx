const TOKEN_PATH_RE = /\/(team\/setup)\/[^/?#]+/g;

export function scrubUrlTokens(url: string): string {
  return url
    .replace(TOKEN_PATH_RE, '/$1/[REDACTED]')
    .replace(
      /([?&])([^=&#]+)=([^&#]*)/g,
      (match, separator: string, key: string) => {
        try {
          return /^(?:code|state|.*token.*|.*secret.*|code_verifier|assertion)$/i.test(
            decodeURIComponent(key.replace(/\+/g, ' ')),
          )
            ? `${separator}${key}=[REDACTED]`
            : match;
        } catch {
          return `${separator}${key}=[REDACTED]`;
        }
      },
    );
}
