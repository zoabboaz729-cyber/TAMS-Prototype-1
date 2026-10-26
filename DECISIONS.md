# DECISIONS.md
(Record every technical decision: date · decision · reason · alternative rejected.)

## 2026-10-26 Baseline Stack Initialization (M0-T1)
- **Decision**: Configured Next.js App Router with TypeScript strict mode, Vitest unit test runner with `@/*` alias, Tailwind CSS, ESLint, and Prisma with SQLite (`dev.db`).
- **Reason**: Matches the prototype stack specification §4 and repository layout §5. Fast to run locally without Docker for prototype demos.
- **Alternative rejected**: PostgreSQL with Docker Compose at this stage (rejected per spec §4 and §11 until M9-T1).
