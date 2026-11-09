# M7 implementation decisions and slice map

Owner authorized all recommended M7 settings, M7-T1–T4 and M7-V0–V5, the M4/M5 seams, dependencies named in the specification, and explicitly waived the file ceiling on 9 November 2026. These are synthetic prototype choices, not university policy.

- Independent Start/End class and Open/Close attendance. No combined operation, room release, backdating or attendance editing.
- Opening and Start during effective scheduled interval only. Scan AFTER_OPEN_UNTIL_END; configurable FINAL_N_MINUTES (15 default); rotating 30 seconds default, lecturer may choose STATIC. CLOSED terminal. End class stops scans without closing QR.
- Twelve-character Base32 typed fallback follows identical rotation, five invalid attempts per account/session in five minutes, lazy deletion after 24 hours in that scope; persistent across workers. No raw credentials retained.
- Semester 2 refuses until configured. Lecturer minimal own-session records, department aggregate, student SELF, officer aggregate. ADMIN denied.
- QR uses qrcode 1.5.4 (135364 unpacked bytes), scanner html5-qrcode 2.3.8 (2627746 bytes, upstream maintenance mode), types @types/qrcode 1.5.6 (18453 bytes). Approved via specification and current owner authorization. Alternatives considered: native BarcodeDetector lacks consistent browser support; writing a decoder/encoder adds unnecessary bespoke logic. No substituted library.
- Optional synthetic attendance demonstration uses server environment, nonproduction local file database and explicit flag, isolated from real attendance rows. Start class always uses real time. M5 URL clock never authorizes writes.
- Legacy attendance metadata stays nullable, unmodified and nonoperational until explicit repair. Composite provenance FKs and Restrict history. No protected database access.

Cohesive commit boundaries consolidate the blueprint's suggested manifests while preserving feature and evidence requirements: T0 baseline/scope; T1a/V0/V1 domain contracts and rules; T1b/V2a schema/migration/fixture; T1c–f crypto/occurrence/throttle foundations; T2/V2b transactional lifecycle; V5 publication gate; T3/V3 transports and UI; T4/V4 reports and M5 overlay; integration verification and patch handoff. Each receives npm run verify; UI and dependency slices also receive build. Owner browser acceptance remains separate.
