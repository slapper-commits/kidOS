# kidOS project instructions

Preserve the agreed Windows 95-inspired simplicity. Build a real local-first Linux appliance, with computer, tablet, and TV layouts. Do not introduce a cloud-account requirement or put personal data into a distributable image.

Read docs/PRODUCT.md, docs/ARCHITECTURE.md and docs/ROADMAP.md before implementation. Keep progress and limitations accurate. Only mark acceptance criteria complete after verification; Linux and physical Pi behavior cannot be certified using a macOS browser preview.

Prefer mature components for protocols, media decoding, image generation and isolation. Do not execute child-supplied server code until a real containment boundary is implemented. Do not treat a kiosk, iframe or DNS filter as system-level isolation. Keep parent controls outside child-app authority. Bind development services to loopback by default.

Do not change the host firewall, DNS, trust store, boot disk or network configuration to test this project. Use isolated fixtures or a dedicated test device. Destructive image flashing and factory-reset drills require an explicitly designated disposable target.

Keep user creations separate from system files. Never embed shared passwords, private certificate-authority keys, family content or device identities in images. Record third-party licenses and media provenance. Use source-controlled migrations, meaningful tests and reproducible builds.

This is separate from AXO. Do not use AXO infrastructure or client instances. Check in with Sean at working milestone boundaries and before major scope changes. No subagents are required by this file.
