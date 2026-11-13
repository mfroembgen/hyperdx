---
'@hyperdx/api': patch
---

Add optional automatic team signup for new users with a verified WorkOS email in
one exact configured domain. Keep existing identity bindings and membership
checks, with automatic signup disabled by default. Preserve removed WorkOS
members as teamless records so automatic signup cannot restore their access, and
revoke their old personal API keys and legacy-session access.

Report password authentication accurately for passwordless team members.
