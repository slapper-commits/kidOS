# Giftable device requirements

Day 0 is not giftable. Local disk persistence and project export are useful foundations, but none of the first-run identity, authentication, signed-update, full-backup, recovery-media, or reset requirements below has been completed. A source checkout plus browser service is not a Raspberry Pi installation image.

- No shared administrator passwords, API keys, cloud sessions, SSH host keys, local CA keys or family content in the image.
- Generate identity and secrets during first boot; parent establishes access.
- Usable offline after setup; no developer account or subscription required.
- One supported hardware configuration and a tested input-device list initially.
- Onboarding explains storage, backups, network enrollment and parent controls.
- Signed, versioned update artifacts; independent user-data storage; tested rollback and compatible migrations.
- Backup/export and recovery procedure that a parent can follow.
- Factory reset removes household data and credentials; explicit confirmation and disposable-device verification.
- Distributable educational/media content only; preserve licenses and attribution. Parents import their own personal collections separately.
- Document limits: a controlled child environment is not a guarantee against a technically capable person with physical access.

The release image must contain system files and distributable starter content only. Each receiving household starts with an empty data directory and generates its own identity, credentials, and certificate keys. Keep a versioned release checklist with evidence from a clean install, an upgrade, restoration of a backup, and a factory reset on a designated disposable device.
