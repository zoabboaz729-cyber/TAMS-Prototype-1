import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/domain/permissions";
import { StartInput, OccurrenceRef, activityDecision } from "@/domain/attendanceRules";
import { attendanceResult, refuse } from "./attendanceErrors";
import { attendanceActor, resolveAttendanceOccurrence, authorizeOccurrence, operationalAttendance } from "./attendanceOccurrence";
import { attendanceAudit } from "./attendanceService";
/** Start/End ALWAYS use real time, including when QR demonstration is enabled. */
export async function reportClassActivity(db: PrismaClient, actor: Actor|null, input: unknown, action: "START"|"END", realNow: Date) {
  return attendanceResult(()=>db.$transaction(async tx=>{
    const user=await attendanceActor(tx,actor);if(user.role!=="LECTURER")refuse("FORBIDDEN");
    const parsed=(action==="START"?StartInput:OccurrenceRef).safeParse(input);if(!parsed.success)refuse("INVALID_INPUT");
    const r=await resolveAttendanceOccurrence(tx,{sourceEntryId:parsed.data.sourceEntryId,originalDate:parsed.data.originalDate});
    authorizeOccurrence(user,"REPORT_CLASS_ACTIVITY",r);
    const key={entryId:r.entry.id,originalDate:parsed.data.originalDate};
    const existing=await tx.classOccurrenceActivity.findUnique({where:{entryId_originalDate:key}});
    if(existing && (existing.versionId!==r.entry.versionId || existing.actualDate!==r.occurrence.actualDate || existing.venueId!==r.entry.venueId || existing.startedBy!==user.id))refuse("INVALID_STORED_DATA");
    const d=activityDecision(existing?.state??null,action,realNow.getTime(),r.starts,r.ends);
    if(d==="ALREADY_STARTED" || (d==="ALREADY_ENDED"&&action==="END"))return {activityId:existing!.id,alreadyReported:true};
    if(d)refuse(d as Parameters<typeof refuse>[0]);
    if(action==="START"){
      operationalAttendance(r);
      const activity=await tx.classOccurrenceActivity.create({data:{...key,versionId:r.entry.versionId,actualDate:r.occurrence.actualDate,actualStart:r.occurrence.actualStart,actualEnd:r.occurrence.actualEnd,venueId:r.entry.venueId,teachingId:r.entry.teachingId,state:"REPORTED_STARTED",startedBy:user.id,startedAt:realNow}});
      await attendanceAudit(tx,user.id,"CLASS_REPORTED_STARTED","ClassOccurrenceActivity",activity.id,realNow);
      return {activityId:activity.id,alreadyReported:false};
    }
    if(realNow<existing!.startedAt)refuse("INVALID_STORED_DATA");
    const updated=await tx.classOccurrenceActivity.updateMany({where:{id:existing!.id,state:"REPORTED_STARTED"},data:{state:"REPORTED_ENDED",endedBy:user.id,endedAt:realNow}});
    if(updated.count!==1)refuse("RETRYABLE");
    await attendanceAudit(tx,user.id,"CLASS_REPORTED_ENDED","ClassOccurrenceActivity",existing!.id,realNow);
    return {activityId:existing!.id,alreadyReported:false};
  }));
}
