import { scheduledInstant } from "@/domain/attendanceRules";
import type { AttendanceTx } from "./attendanceOccurrence";
/** Rechecked inside publication transaction; forgotten End cannot block forever. */
export async function hasActiveAttendance(tx: AttendanceTx, versionIds: string[], now: Date): Promise<boolean> {
  if(!versionIds.length)return false;
  const activities=await tx.classOccurrenceActivity.findMany({where:{versionId:{in:versionIds},state:"REPORTED_STARTED"}});
  for(const a of activities){const starts=scheduledInstant(a.actualDate,a.actualStart),ends=scheduledInstant(a.actualDate,a.actualEnd);if(starts<=now.getTime()&&now.getTime()<ends)return true;}
  const sessions=await tx.attendanceSession.findMany({where:{versionId:{in:versionIds},status:"OPEN",simulated:false,opensAt:{lte:now},closesAt:{gt:now}}});
  for(const s of sessions){if(!s.actualDate||!s.actualStart||!s.actualEnd)throw new Error("INVALID_STORED_DATA");if(scheduledInstant(s.actualDate,s.actualStart)<=now.getTime()&&now.getTime()<scheduledInstant(s.actualDate,s.actualEnd))return true;}
  return false;
}
