import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ origin: "https://demo.test", host: "demo.test", actor: { id: "lecturer", role: "LECTURER", departmentId: "d", studentGroupId: null }, submit: vi.fn(), cancel: vi.fn(), decide: vi.fn(), create: vi.fn(), update: vi.fn(), repair: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["origin", state.origin], ["host", state.host]]) }));
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => state.actor }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/rescheduleService", () => ({ submitReschedule: state.submit, cancelReschedule: state.cancel, decideReschedule: state.decide }));
vi.mock("@/server/issueService", () => ({ createIssue: state.create, updateIssue: state.update }));
vi.mock("@/server/draftExceptionRepair", () => ({ repairDraftException: state.repair }));
import { submitRescheduleAction, cancelRescheduleAction } from "@/app/lecturer/reschedule/actions";
import { decideRescheduleAction } from "@/app/officer/reschedules/actions";
import { createIssueAction, updateIssueAction } from "@/app/issues/actions";
import { repairDraftExceptionAction } from "@/app/officer/draft/exceptionActions";
const actions = [[submitRescheduleAction, state.submit], [cancelRescheduleAction, state.cancel], [decideRescheduleAction, state.decide], [createIssueAction, state.create], [updateIssueAction, state.update], [repairDraftExceptionAction, state.repair]] as const;
beforeEach(() => { state.origin = "https://demo.test"; vi.clearAllMocks(); for (const [, service] of actions)
    service.mockResolvedValue({ ok: true, value: { status: "PENDING" } }); });
describe("M6 same-origin action boundary", () => {
    for (const [action, service] of actions) {
        it(`${action.name} refuses cross-origin before service`, async () => { state.origin = "https://evil.test"; expect(await action({})).toMatchObject({ ok: false, code: "FORBIDDEN" }); expect(service).not.toHaveBeenCalled(); });
        it(`${action.name} uses trusted session and preserves strict input`, async () => { const input = { actorId: "forged", unknown: "do not strip" }; await action(input); expect(service.mock.calls[0][1]).toEqual(state.actor); expect(service.mock.calls[0][2]).toBe(input); });
    }
});
