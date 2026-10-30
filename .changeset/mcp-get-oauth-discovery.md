---
'@hyperdx/api': patch
---

Advertise OAuth discovery to unauthenticated MCP GET probes. Authenticated GET
requests still return 405 because the stateless transport accepts POST only.
