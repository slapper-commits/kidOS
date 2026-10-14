# Security policy

kidOS is a developer preview for supervised experimentation. It is not yet a hardened child appliance. Only the newest published preview is a maintenance target; there is no security response-time guarantee or long-term supported release yet.

## Report privately

Use **Security → Report a vulnerability** on the official GitHub repository. Do not put exploit details, credentials or household data in a public issue. If private reporting is unavailable, open an issue asking the maintainer for a private contact without including vulnerability details.

Describe the affected release, prerequisites, reproduction steps, impact and a suggested fix if available. Use isolated synthetic fixtures. Never test against another household's device or expose a development service to the internet.

## Current boundaries

- Services bind to loopback and validate browser requests. This is not parent authentication.
- Browser apps use a separate origin and sandbox. They are not fully contained at the operating-system or network level; use trusted local projects only.
- Native apps run as the ordinary desktop user through a fixed-command bridge. Native applications share that user's authority.
- Separately authenticated parent administration, secure device updates, first-run enrollment and recovery media remain unfinished.
- Release checksums detect changed bytes but do not independently authenticate a publisher. No automatic update installation is provided in this preview.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [GIFTABLE.md](docs/GIFTABLE.md) for the full boundary and remaining acceptance criteria.
