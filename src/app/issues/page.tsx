import Link from "next/link";
import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import { listIssues } from "@/server/issueService";
import M6Form from "@/components/M6Form";
import { updateIssueAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function IssuesPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const actor = await requireAnyAction("SEE_ISSUES");
    const q = await searchParams;
    const result = await listIssues(prisma, actor, q);
    const page = typeof q.page === "string" ? Number(q.page) : 0;
    return <main className="mx-auto max-w-4xl space-y-4 p-4"><h1 className="text-2xl font-bold">Issues</h1><p>25 issues per page, newest first. Department accounts see only their home department.</p>
    <form><label>Status <select name="status"><option>OPEN</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>CLOSED</option></select></label><button type="submit">Filter</button></form><Link href="/issues">All statuses</Link>
    {!result.ok ? <p role="alert">{result.message}</p> : <>{result.value.map(r => <section key={r.id} className="rounded border p-4 space-y-2"><h2>{r.status} · {r.id}</h2><p className="whitespace-pre-wrap break-words">{r.text}</p><p>{r.createdAt.toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} EAT</p>
      {actor.role === "OFFICER" && r.status !== "CLOSED" && <M6Form action={updateIssueAction} label="Update status" fixed={{ issueId: r.id, expectedStatus: r.status }}><label>Next status <select name="nextStatus">{(r.status === "OPEN" ? ["IN_PROGRESS", "RESOLVED"] : r.status === "IN_PROGRESS" ? ["RESOLVED"] : ["IN_PROGRESS", "CLOSED"]).map(s => <option key={s}>{s}</option>)}</select></label><label className="block">Reason (required for resolve, reopen or close) <textarea className="block w-full border" name="note" maxLength={500}/></label></M6Form>}
    </section>)}<nav className="flex gap-4" aria-label="Issue pages">{page > 0 && <Link href={`/issues?page=${page - 1}${typeof q.status === "string" ? `&status=${q.status}` : ""}`}>Previous</Link>}{result.value.length === 25 && <Link href={`/issues?page=${page + 1}${typeof q.status === "string" ? `&status=${q.status}` : ""}`}>Next</Link>}</nav></>}
  </main>;
}
