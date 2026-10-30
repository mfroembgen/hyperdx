---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

Advertise OAuth discovery to unauthenticated MCP GET probes. Authenticated GET
requests still return 405 because the stateless transport accepts POST only.

Expose standard protected-resource metadata URLs so native clients can discover
the authorization server from the MCP URL before signing in.
