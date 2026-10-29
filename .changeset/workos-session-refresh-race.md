---
'@hyperdx/api': patch
---

Preserve the current WorkOS browser session when concurrent requests refresh the
same credentials. Compare and update only the stored seal so a delayed refresh
cannot erase a newer login or restore a session removed by logout.
