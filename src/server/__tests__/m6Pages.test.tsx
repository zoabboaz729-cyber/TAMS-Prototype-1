import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, it, expect, vi } from "vitest";
vi.stubGlobal("React", React);
const state = vi.hoisted(() => ({ role: "DEPT_REP", allowed: true, list: vi.fn(), guard: vi.fn(), venues: vi.fn() }));
vi.mock("@/server/guards", () => ({ requireAnyAction: async (action: string) => { state.guard(action); if (!state.allowed)
        throw new Error("FORBIDDEN"); return { id: "rep", role: state.role, departmentId: "d", studentGroupId: null }; } }));
vi.mock("@/server/db", () => ({ prisma: { venue: { findMany: state.venues } } }));
vi.mock("@/server/issueService", () => ({ listIssues: state.list }));
vi.mock("@/app/issues/actions", () => ({ createIssueAction: vi.fn(), updateIssueAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: {
        children: React.ReactNode;
        href: string;
    }) => <a href={href}>{children}</a> }));
import IssuesPage from "@/app/issues/page";
import IssueNewPage from "@/app/issues/new/page";
beforeEach(() => { vi.clearAllMocks(); state.role = "DEPT_REP"; state.allowed = true; state.venues.mockResolvedValue([]); state.list.mockResolvedValue({ ok: true, value: [{ id: "issue", text: "<script>alert('x')</script>", status: "OPEN", departmentId: "d", createdAt: new Date("2026-11-08T12:00:00Z") }] }); });
describe("M6 issue presentation", () => {
    it("escapes reporter text and keeps department queue read-only", async () => { const html = renderToStaticMarkup(await IssuesPage({ searchParams: Promise.resolve({}) })); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain("Update status"); expect(state.guard).toHaveBeenCalledWith("SEE_ISSUES"); });
    it("officer alone sees status controls", async () => { state.role = "OFFICER"; const html = renderToStaticMarkup(await IssuesPage({ searchParams: Promise.resolve({}) })); expect(html).toContain("Update status"); });
    it("queue guard denies before issue reads", async () => { state.allowed = false; await expect(IssuesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("FORBIDDEN"); expect(state.list).not.toHaveBeenCalled(); });
    it("reporter form includes privacy guidance and bounded description", async () => { const html = renderToStaticMarkup(await IssueNewPage()); expect(state.guard).toHaveBeenCalledWith("REPORT_ISSUE"); expect(html).toContain("Do not enter passwords, student registration numbers or unnecessary personal information."); expect(html).toContain('maxLength="1000"'); expect(html).toContain("Submit issue"); });
});
