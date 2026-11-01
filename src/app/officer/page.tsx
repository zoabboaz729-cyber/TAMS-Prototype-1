/** /officer — timetabling officer placeholder (task M1-T3c-5). */
import { requireAction } from "@/server/guards";

export default async function OfficerPage() {
  await requireAction("EDIT_DRAFT");

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-bold text-slate-800">
        Officer area (placeholder)
      </h1>
      <p className="mt-4 text-slate-600">
        This area will hold the timetable tools for drafting and generating
        the timetable.
      </p>
    </main>
  );
}