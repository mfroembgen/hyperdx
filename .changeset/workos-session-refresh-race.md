---
'@hyperdx/api': patch
---

Preserve the current WorkOS browser session when concurrent requests refresh the
same credentials. Compare and update only the stored seal so a delayed refresh
cannot erase a newer login or restore a session removed by logout.

Apply the same atomic updates to sign-in initialization and one-time callback
consumption. Completed logout cancels an in-flight login, and a newly generated
session is persisted once before its cookie is sent.
