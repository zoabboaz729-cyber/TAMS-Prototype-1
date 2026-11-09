import type { PrismaClient, AttendanceSession } from "@prisma/client";
import { OpenInput, SessionInput, ScanInput, computeScanWindow, scanDecision } from "@/domain/attendanceRules";
import type { Actor } from "@/domain/permissions";
import { attendanceResult, refuse } from "./attendanceErrors";
import { attendanceActor, resolveAttendanceOccurrence, authorizeOccurrence, operationalAttendance, type AttendanceTx } from "./attendanceOccurrence";
import { signAttendanceToken, verifyAttendanceToken, typedAttendanceCode, verifyTypedCode } from "./attendanceTokens";
import type { AttendanceRuntime } from "./attendanceRuntime";
export async function attendanceAudit(tx: AttendanceTx, actorId: string, action: string, entity: string, entityId: string, at: Date, simulated = false) {
  await tx.auditLog.create({data:{actorId,action,entity,entityId,at,reason:simulated?"SYNTHETIC_SIMULATION":null}});
}
function assertSimulation(user: {email:string}, runtime: AttendanceRuntime) {
  if(runtime.simulated && !user.email.endsWith("@demo.tams.test")) refuse("FORBIDDEN");
}
export async function resolveSession(tx: AttendanceTx, id: string, runtime: AttendanceRuntime) {
  const s=await tx.attendanceSession.findUnique({where:{id}});
  if(!s) refuse("NOT_FOUND");
  if(!s.versionId || !s.originalDate || !s.actualDate || !s.actualStart || !s.actualEnd) refuse("INVALID_STORED_DATA");
  if(s.simulated!==runtime.simulated) refuse("CONFIGURATION");
  const r=await resolveAttendanceOccurrence(tx,{sourceEntryId:s.entryId,originalDate:s.originalDate});
  if(s.versionId!==r.entry.versionId || s.actualDate!==r.occurrence.actualDate || s.actualStart!==r.occurrence.actualStart || s.actualEnd!==r.occurrence.actualEnd || s.openedBy!==r.entry.teaching.lecturer.userId || s.timeZone!=="Africa/Nairobi") refuse("INVALID_STORED_DATA");
  if(s.opensAt.getTime()<r.starts || s.opensAt.getTime()>=r.ends || s.scanFrom<s.opensAt || s.scanFrom>=s.closesAt || s.closesAt.getTime()>r.ends || !["STATIC","ROTATING"].includes(s.mode) || s.tokenGeneration<0) refuse("INVALID_STORED_DATA");
  return {s,r};
}
export async function openAttendance(db: PrismaClient, actor: Actor|null, input: unknown, runtime: AttendanceRuntime) {
  return attendanceResult(()=>db.$transaction(async tx=>{
    const user=await attendanceActor(tx,actor); if(user.role!=="LECTURER") refuse("FORBIDDEN"); assertSimulation(user,runtime);
    const p=OpenInput.safeParse(input); if(!p.success) refuse("INVALID_INPUT");
    const r=await resolveAttendanceOccurrence(tx,{sourceEntryId:p.data.sourceEntryId,originalDate:p.data.originalDate});
    authorizeOccurrence(user,"OPEN_ATTENDANCE",r); operationalAttendance(r);
    let window; try { window=computeScanWindow(r.occurrence.actualDate,r.occurrence.actualStart,r.occurrence.actualEnd,runtime.now.getTime(),runtime.policy); }catch{refuse("NOT_IN_OPEN_WINDOW");}
    const existing=await tx.attendanceSession.findUnique({where:{entryId_originalDate:{entryId:r.entry.id,originalDate:p.data.originalDate}}});
    if(existing){if(existing.status!=="OPEN")refuse("NOT_OPEN"); await resolveSession(tx,existing.id,runtime); return {sessionId:existing.id,alreadyOpen:true};}
    const session=await tx.attendanceSession.create({data:{entryId:r.entry.id,versionId:r.entry.versionId,originalDate:p.data.originalDate,actualDate:r.occurrence.actualDate,actualStart:r.occurrence.actualStart,actualEnd:r.occurrence.actualEnd,openedBy:user.id,opensAt:runtime.now,scanFrom:new Date(window.scanFromMs),closesAt:new Date(window.closesAtMs),mode:p.data.mode,simulated:runtime.simulated,policyVersion:`M7-v1:${runtime.policy.scanWindowKind}:${runtime.policy.scanWindowMinutes}`}});
    await attendanceAudit(tx,user.id,"ATTENDANCE_SESSION_OPENED","AttendanceSession",session.id,runtime.now,runtime.simulated);
    return {sessionId:session.id,alreadyOpen:false};
  }));
}
export async function closeAttendance(db: PrismaClient, actor: Actor|null, input: unknown, runtime: AttendanceRuntime) {
  return attendanceResult(()=>db.$transaction(async tx=>{
    const user=await attendanceActor(tx,actor); if(user.role!=="LECTURER")refuse("FORBIDDEN");
    const p=SessionInput.safeParse(input);if(!p.success)refuse("INVALID_INPUT");
    // Closing remains possible after expiry or archival; ownership is read from retained entry.
    const s=await tx.attendanceSession.findUnique({where:{id:p.data.sessionId},include:{entry:{include:{teaching:{include:{lecturer:true}}}}}});
    if(!s)refuse("NOT_FOUND");
    if(s.entry.teaching.lecturer.userId!==user.id || s.openedBy!==user.id)refuse("FORBIDDEN");
    if(s.simulated!==runtime.simulated)refuse("CONFIGURATION");
    if(s.status==="CLOSED")return {sessionId:s.id,alreadyClosed:true};
    if(s.status!=="OPEN")refuse("NOT_OPEN");
    const updated=await tx.attendanceSession.updateMany({where:{id:s.id,status:"OPEN",tokenGeneration:s.tokenGeneration},data:{status:"CLOSED",closedAt:runtime.now,tokenGeneration:{increment:1}}});
    if(updated.count!==1)refuse("RETRYABLE");
    await attendanceAudit(tx,user.id,"ATTENDANCE_SESSION_CLOSED","AttendanceSession",s.id,runtime.now,runtime.simulated);
    return {sessionId:s.id,alreadyClosed:false};
  }));
}
async function scanEligibility(tx: AttendanceTx, user: Actor, s: AttendanceSession, r: Awaited<ReturnType<typeof resolveAttendanceOccurrence>>, now: Date) {
  authorizeOccurrence(user,"SCAN_ATTENDANCE",r); operationalAttendance(r);
  const activity=await tx.classOccurrenceActivity.findUnique({where:{entryId_originalDate:{entryId:s.entryId,originalDate:s.originalDate!}}});
  const duplicate=await tx.attendanceRecord.findUnique({where:{sessionId_studentId:{sessionId:s.id,studentId:user.id}}});
  const decision=scanDecision({nowMs:now.getTime(),opensAt:s.opensAt.getTime(),scanFrom:s.scanFrom.getTime(),closesAt:s.closesAt.getTime(),status:s.status,groupId:user.studentGroupId,requiredGroupId:r.entry.teaching.groupId,duplicate:!!duplicate,classEnded:activity?.state==="REPORTED_ENDED"});
  if(decision)refuse(decision as Parameters<typeof refuse>[0]);
}
export async function scanAttendance(db: PrismaClient, actor: Actor|null, input: unknown, runtime: AttendanceRuntime) {
  return attendanceResult(async()=>{
    const outcome=await db.$transaction(async tx=>{
      const user=await attendanceActor(tx,actor); if(user.role!=="STUDENT")refuse("FORBIDDEN"); assertSimulation(user,runtime);
      const p=ScanInput.safeParse(input);if(!p.success)refuse("INVALID_INPUT");
      const proof=p.data.method==="QR"?verifyAttendanceToken(p.data.token,runtime.secret,runtime.now.getTime()):null;
      if(p.data.method==="QR"&&!proof)refuse("INVALID_CODE");
      const id=p.data.method==="QR"?proof!.sid:p.data.sessionId;
      const {s,r}=await resolveSession(tx,id,runtime);
      await scanEligibility(tx,user,s,r,runtime.now);
      if(p.data.method==="CODE"){
        await tx.attendanceAttempt.deleteMany({where:{studentId:user.id,windowStart:{lt:new Date(runtime.now.getTime()-86400000)}}});
        const key={sessionId:s.id,studentId:user.id}, prior=await tx.attendanceAttempt.findUnique({where:{sessionId_studentId:key}});
        const recent=prior && runtime.now.getTime()-prior.windowStart.getTime()<300000;
        if(recent && prior.failures>=5)return {failure:"RATE_LIMITED" as const};
        if(!verifyTypedCode(p.data.code,s,runtime.secret,runtime.now.getTime())){
          await tx.attendanceAttempt.upsert({where:{sessionId_studentId:key},create:{...key,windowStart:runtime.now,failures:1},update:recent?{failures:{increment:1}}:{windowStart:runtime.now,failures:1}});
          return {failure:"INVALID_CODE" as const};
        }
      }else if(!proof || proof.sid!==s.id || proof.gen!==s.tokenGeneration || proof.mode!==s.mode || proof.expMs>s.closesAt.getTime())refuse("INVALID_CODE");
      const record=await tx.attendanceRecord.create({data:{sessionId:s.id,studentId:user.id,recordedAt:runtime.now,deviceId:p.data.deviceId??null}});
      await attendanceAudit(tx,user.id,"ATTENDANCE_CONFIRMED","AttendanceRecord",record.id,runtime.now,runtime.simulated);
      return {recordId:record.id,recordedAt:record.recordedAt.toISOString(),simulated:runtime.simulated};
    });
    if("failure" in outcome)refuse(outcome.failure!);
    return outcome;
  });
}
export async function lecturerCredential(db: PrismaClient, actor: Actor|null, id: string, runtime: AttendanceRuntime) {
  return attendanceResult(()=>db.$transaction(async tx=>{
    const user=await attendanceActor(tx,actor);if(user.role!=="LECTURER")refuse("FORBIDDEN");
    const {s,r}=await resolveSession(tx,id,runtime);authorizeOccurrence(user,"OPEN_ATTENDANCE",r);operationalAttendance(r);
    if(s.status!=="OPEN")refuse("NOT_OPEN");
    if(runtime.now<s.opensAt || runtime.now>=s.closesAt)refuse("EXPIRED");
    const activity=await tx.classOccurrenceActivity.findUnique({where:{entryId_originalDate:{entryId:s.entryId,originalDate:s.originalDate!}}});
    if(activity?.state==="REPORTED_ENDED")refuse("CLASS_REPORTED_ENDED");
    return {token:signAttendanceToken(s,runtime.secret,runtime.now.getTime()),code:typedAttendanceCode(s,runtime.secret,runtime.now.getTime()),expiresAt:new Date(Math.min(s.closesAt.getTime(),s.mode==="ROTATING"?(Math.floor(runtime.now.getTime()/30000)+1)*30000:Infinity)).toISOString(),scanFrom:s.scanFrom.toISOString(),closesAt:s.closesAt.toISOString(),simulated:s.simulated};
  }));
}
