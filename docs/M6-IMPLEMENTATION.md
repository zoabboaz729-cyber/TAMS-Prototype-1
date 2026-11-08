# M6 implementation map and revised commit boundaries

Owner authorized the whole revision-2 blueprint and waived the five-file ceiling. The proposed 35-commit manifests are explicitly consolidated below into cohesive implementation slices, rather than introducing duplicate injected-store and Prisma wrapper layers. Each slice remains separately committed and receives exact-tree verification during patch replay. This is an explicit adjustment to the proposed commit plan, not a reduction of feature or verification requirements.

| Implementation slice | Blueprint coverage |
|---|---|
| T0 scope lock | T0 |
| T1a calendar | T1a |
| T1b schema + migration | T1b |
| T1c occurrence projection and assessment | T1c–T1d |
| T1e request rules and strict contracts | T1e |
| T1f shared snapshot and error contracts | T1f–T1g foundations |
| T1h transactional reschedule service | T1f–T1i service/store behavior |
| T1j secure actions and forms | T1j–T1m |
| T1n M4 provenance/dated publication gate | T1n–T1p |
| T1q protected date view | T1q–T1s |
| T1t date-aware M5 board | T1t–T1v |
| T1w dated draft repair and lifecycle integration | T1w + repair path |
| T2a issue rules and precise permission | T2a–T2b |
| T2c transactional issue service | T2c–T2e |
| T2f guarded issue forms/queue | T2f–T2h |
| T2i navigation and acceptance regressions | T2i, T1w navigation |
| T3a1 lifecycle hardening and T3a2 final source/calendar regressions | Cross-module acceptance and final review |
| T3a evidence and handoff | T3a |
| T3b | Reserved for actual owner manual acceptance, not performed by agent |

Synthetic semester 1: 2026-09-01–2026-12-18, Africa/Nairobi. Semester 2 has no dated window. This configuration is not institutional policy. No notifications, M7 attendance implementation, dependency additions, protected database operations, or remote writes are included.

Both reschedule kinds inherit the original venue. A complete conflict override creates only a repair DRAFT. The officer draft editor exposes existing dated overlays and draft-only date/time repair; publication independently rechecks all weekly and dated constraints, source provenance, operational venue status, calendar configuration and snapshot currency.

Legacy migration preflight: inspect pending requests on a user-approved disposable copy. More than one PENDING row for the same entry aborts the atomic migration. Resolve duplicates explicitly before retrying; no request is silently discarded. Existing requests default to WEEKLY and pending claims are backfilled; all original fields and records are retained.

Verification uses disposable synthetic SQLite and unchanged existing M0–M5 tests except explicit permission/menu assertions updated for delivered functionality. The patch bundle includes all real outputs, exact base/head/tree hashes and replay comparison. Automated/static/HTTP checks are not user browser acceptance; M6 remains pending owner acceptance.
