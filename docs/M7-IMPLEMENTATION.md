# M7 implementation decisions and slice map

Status: M7 ACCEPTED/CLOSED on 9 November 2026 following the owner's report that the manual acceptance checklist was completed and everything behaved as expected. This is owner-reported acceptance, not an agent-run device test; see M7-MANUAL-ACCEPTANCE.md and M7-VERIFICATION.md for attribution and retained limitations. M8 implementation has not started.

Owner authorized all recommended M7 settings, M7-T1–T4 and M7-V0–V5, the M4/M5 seams, dependencies named in the specification, and explicitly waived the file ceiling on 9 November 2026. These are synthetic prototype choices, not university policy.

- Independent Start/End class and Open/Close attendance. No combined operation, room release, backdating or attendance editing.
- Opening and Start during effective scheduled interval only. Scan AFTER_OPEN_UNTIL_END; configurable FINAL_N_MINUTES (15 default); rotating 30 seconds default, lecturer may choose STATIC. CLOSED terminal. End class stops scans without closing QR.
- Twelve-character Base32 typed fallback follows identical rotation, five invalid attempts per account/session in five minutes, lazy deletion after 24 hours in that scope; persistent across workers. No raw credentials retained.
- Semester 2 refuses until configured. Lecturer minimal own-session records, department aggregate, student SELF, officer aggregate. ADMIN denied.
- QR uses qrcode 1.5.4 (135364 unpacked bytes), scanner html5-qrcode 2.3.8 (2627746 bytes, upstream maintenance mode), types @types/qrcode 1.5.6 (18453 bytes). Approved via specification and current owner authorization. Alternatives considered: native BarcodeDetector lacks consistent browser support; writing a decoder/encoder adds unnecessary bespoke logic. No substituted library.
- Optional synthetic attendance demonstration uses server environment, nonproduction local file database and explicit flag, isolated from real attendance rows. Start class always uses real time. M5 URL clock never authorizes writes.
- Legacy attendance metadata stays nullable, unmodified and nonoperational until explicit repair. Composite provenance FKs and Restrict history. No protected database access.

Cohesive commit boundaries consolidate the blueprint's suggested manifests while preserving feature and evidence requirements: T0 baseline/scope; T1a/V0/V1 domain contracts and rules; T1b/V2a schema/migration/fixture; T1c–f crypto/occurrence/throttle foundations; T2/V2b transactional lifecycle; V5 publication gate; T3/V3 transports and UI; T4/V4 reports and M5 overlay; integration verification and patch handoff. Each receives npm run verify; UI and dependency slices also receive build. Owner browser acceptance remains separate.


## Final implementation map

| Commit slice | Blueprint coverage |
|---|---|
| M7-T1 foundations | T0a, T1a/b, V0/V1/V2a; approval record, pure contracts, safe schema and upgrade evidence |
| M7-T2 lifecycle | T0b, T1c–g, T2a–e, V2b; fixture, resolver, credentials/throttle, transactions and audit |
| M7-V5 publication | T2i, V5; current-publication and in-progress safeguards |
| M7-T2h hardening | Transaction clocks, activity integrity, expanded real SQLite race/rollback and protocol regressions |
| M7-T4 reports/M5 | T4a/b/d, V3b/V4; report services/page, independent activity history and one-snapshot M5 overlay |
| M7-T3 web journeys | T2f–h, T3a–h, V3a, T4c; guarded endpoints/actions, QR/scanner/typed fallback, menus and HTTP/SSR tests |
| M7-T4e handoff | Verification/acceptance docs, raw outputs, exact-tree patch replay and application instructions |

The cohesive slices replace the blueprint's suggested per-file manifests under the owner's full-M7 authorization and file waiver. The report reader preceded final web integration because private summary endpoints and page tests depend on it. No feature/acceptance requirement is removed. Every delivered commit is independently verified during replay. Manual device testing is performed by the owner, never inferred from HTTP or mocked-camera checks.
