import { requireAnyAction } from "@/server/guards";
import { prisma } from "@/server/db";
import M6Form from "@/components/M6Form";
import { createIssueAction } from "../actions";
export const dynamic = "force-dynamic";
export default async function IssueNewPage() {
  const actor = await requireAnyAction("REPORT_ISSUE");
  if (!actor.departmentId) return <main><h1>Report an issue</h1><p role="alert">Your home department is not linked. Ask an officer to correct your account before reporting.</p></main>;
  const venues = await prisma.venue.findMany({ select:{ id:true,code:true }, orderBy:{ code:"asc" } });
  return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-2xl font-bold">Report an issue</h1><p>Do not enter passwords, student registration numbers or unnecessary personal information.</p><p>Reports belong to your stored home department, including shared or maintenance rooms. Reports do not reserve rooms or change the timetable.</p>
    <M6Form action={asyncIssue} label="Submit issue"><label className="block">Issue description <textarea name="text" required minLength={10} maxLength={1000} className="block w-full border" /></label><label className="block">Optional venue <select name="venueId"><option value="">No specific venue</option>{venues.map(v => <option key={v.id} value={v.id}>{v.code}</option>)}</select></label></M6Form>
  </main>;
}
async function asyncIssue(input: unknown) { "use server";
  // Empty selection means no venue; the service still rejects every forged key.
  if (typeof input === "object" && input !== null && "venueId" in input && input.venueId === "") input = { ...input, venueId:null };
  return createIssueAction(input);
}
