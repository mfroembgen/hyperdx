declare global {
  interface Window {
    __ENV?: Record<string, string | undefined>;
  }
}

export function env(key: `NEXT_PUBLIC_${string}`): string | undefined {
  return typeof window === 'undefined' ? process.env[key] : window.__ENV?.[key];
}
