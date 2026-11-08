import { describe,it,expect } from "vitest";
import { issueTransition } from "../issueRules";
describe("M6 issue transitions", () => {
  it.each([["OPEN","IN_PROGRESS",""],["OPEN","RESOLVED","Fixed issue"],["IN_PROGRESS","RESOLVED","Fixed issue"],["RESOLVED","IN_PROGRESS","Still broken"],["RESOLVED","CLOSED","Verified fixed"]])("allows %s to %s", (a,b,n) => expect(issueTransition(a,b,n)).toBeNull());
  it.each([["OPEN","CLOSED"],["CLOSED","IN_PROGRESS"],["BAD","RESOLVED"],["OPEN","OPEN"]])("blocks %s to %s", (a,b) => expect(issueTransition(a,b,"Reason given")).not.toBeNull());
  it("requires substantive notes", () => expect(issueTransition("RESOLVED","CLOSED"," ")).toBe("NOTE_REQUIRED"));
});
