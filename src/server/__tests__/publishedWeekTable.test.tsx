// Static-markup tests only; browser geometry, keyboard scrolling and responsive layout need a later live walkthrough.
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPublishedWeekGrid, type PublishedWeekGrid } from "@/domain/publishedWeekGrid";
import { DEFAULT_POLICY, type PolicyConfig } from "@/domain/policy";
import type { DisplayableEntry, ViewingPerspective } from "@/server/publishedTimetableContract";

(globalThis as { React?: typeof React }).React = React;
const { PublishedWeekTable } = await import("@/app/timetable/PublishedWeekTable");

const entry = (id: string, over: Partial<DisplayableEntry> = {}): DisplayableEntry => ({
  id, versionId: "ver-render-1", teachingId: `teach-${id}`, day: "MON", start: "08:00", end: "09:00",
  unitCode: "TAMS 101", unitTitle: "Timetabling Foundations", groupId: "group-render-1", groupName: "SE-Y4",
  lecturerId: "lect-render-1", lecturerName: "Lecturer A", venueId: "venue-render-1", venueCode: "LH1", ...over,
});
const policy = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({ ...DEFAULT_POLICY, ...over });
function gridOf(entries: readonly DisplayableEntry[], over: Partial<PolicyConfig> = {}): PublishedWeekGrid {
  const result = buildPublishedWeekGrid(entries, policy(over));
  if (!result.ok) throw new Error(`fixture grid failed: ${result.kind}`);
  return result.grid;
}
const render = (grid: PublishedWeekGrid, view: ViewingPerspective = "group"): string =>
  renderToStaticMarkup(createElement(PublishedWeekTable, { grid, view }));
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function liBlock(html: string, attribute: string, value: string): string {
  const start = html.indexOf(`<li ${attribute}="${value}"`);
  if (start < 0) throw new Error(`missing li ${attribute}=${value}`);
  const end = html.indexOf("</li>", start);
  return html.slice(start, end + 5);
}
function dayBlock(html: string, day: string): string {
  const start = html.indexOf(`<section data-day="${day}"`);
  if (start < 0) throw new Error(`missing day ${day}`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end + 10);
}
function sessionIds(html: string): string[] {
  const ids: string[] = [];
  const pattern = /data-entry-id="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) ids.push(match[1]);
  return ids;
}

describe("PublishedWeekTable static markup", () => {
  it("1: an empty grid has an honest empty state", () => {
    const html = render(gridOf([]));
    expect(html).toContain("This selected timetable contains no sessions.");
    expect(html).toContain('aria-label="Empty timetable"');
    for (const claim of ["No published version exists", "Publication failed", "All classes are complete"]) {
      expect(html).not.toContain(claim);
    }
  });
  it("2: days render in policy order", () => {
    const days = ["WED", "MON", "SAT"];
    const html = render(gridOf(days.map((day, index) => entry(`e-${index}`, { day })), { days }));
    const positions = days.map((day) => html.indexOf(`data-day="${day}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
  it("3: time labels render correctly", () => {
    const grid = gridOf([]);
    const html = render(grid);
    expect(count(dayBlock(html, "MON"), 'data-time-slot="')).toBe(grid.slots.length);
    for (const slot of grid.slots) {
      const block = liBlock(html, "data-time-slot", slot.id);
      expect(block).toContain(slot.start);
      expect(block).toContain(slot.end);
    }
  });
  it("4: lunch is visible", () => {
    const grid = gridOf([]);
    const html = render(grid);
    const lunch = grid.slots.find((slot) => slot.isLunch);
    expect(lunch).toBeDefined();
    expect(liBlock(html, "data-slot-id", lunch!.id)).toContain("Lunch break");
    expect(dayBlock(html, "MON")).toContain("Lunch break 13:00–14:00");
  });
  it("5: a one-hour session appears once", () => {
    const html = render(gridOf([entry("e1")]));
    expect(count(html, 'data-entry-id="e1"')).toBe(1);
    const block = liBlock(html, "data-entry-id", "e1");
    expect(block).toContain('data-slot-span="1"');
    expect(block).toContain('data-duration-minutes="60"');
  });
  it("6: a two-hour session remains one block", () => {
    const html = render(gridOf([entry("e1", { start: "09:00", end: "11:00" })]));
    expect(count(html, 'data-entry-id="e1"')).toBe(1);
    const block = liBlock(html, "data-entry-id", "e1");
    expect(block).toContain("grid-row:2 / 4");
    expect(block).toContain('data-slot-span="2"');
    expect(block).toContain('data-duration-minutes="120"');
  });
  it("7: a three-hour session remains one block", () => {
    const html = render(gridOf([entry("e1", { start: "08:00", end: "11:00" })]));
    expect(count(html, 'data-entry-id="e1"')).toBe(1);
    const block = liBlock(html, "data-entry-id", "e1");
    expect(block).toContain("grid-row:1 / 4");
    expect(block).toContain('data-slot-span="3"');
    expect(block).toContain('data-duration-minutes="180"');
  });
  it("8: day placement is correct", () => {
    const html = render(gridOf([entry("m"), entry("t", { day: "TUE" })]));
    expect(dayBlock(html, "MON")).toContain('data-entry-id="m"');
    expect(dayBlock(html, "MON")).not.toContain('data-entry-id="t"');
    expect(dayBlock(html, "TUE")).toContain('data-entry-id="t"');
    expect(liBlock(html, "data-entry-id", "t")).toContain('data-day-index="1"');
  });
  it("9: session start and end labels are correct", () => {
    const block = liBlock(render(gridOf([entry("e1", { start: "09:00", end: "11:00" })])), "data-entry-id", "e1");
    expect(block).toContain("Start and end time:");
    expect(block).toContain("09:00–11:00");
  });
  it("10: unit code and title are shown", () => {
    const block = liBlock(render(gridOf([entry("e1")])), "data-entry-id", "e1");
    expect(block).toContain("TAMS 101");
    expect(block).toContain("Timetabling Foundations");
  });
  it("11: group view shows lecturer and venue", () => {
    const block = liBlock(render(gridOf([entry("e1")]), "group"), "data-entry-id", "e1");
    expect(block).toContain(">Lecturer</dt>");
    expect(block).toContain("Lecturer A");
    expect(block).toContain(">Venue</dt>");
    expect(block).toContain("LH1");
  });
  it("12: lecturer view shows group and venue", () => {
    const block = liBlock(render(gridOf([entry("e1")]), "lecturer"), "data-entry-id", "e1");
    expect(block).toContain(">Student group</dt>");
    expect(block).toContain("SE-Y4");
    expect(block).toContain(">Venue</dt>");
    expect(block).toContain("LH1");
  });
  it("13: venue view shows group and lecturer", () => {
    const block = liBlock(render(gridOf([entry("e1")]), "venue"), "data-entry-id", "e1");
    expect(block).toContain(">Student group</dt>");
    expect(block).toContain("SE-Y4");
    expect(block).toContain(">Lecturer</dt>");
    expect(block).toContain("Lecturer A");
  });
  it("14: two exact-overlap entries both render", () => {
    const grid = gridOf([entry("a"), entry("b", { unitCode: "TAMS 102", unitTitle: "Scheduling Laboratory" })]);
    const html = render(grid);
    expect(grid.hasOverlaps).toBe(true);
    expect(count(html, 'data-entry-id="a"')).toBe(1);
    expect(count(html, 'data-entry-id="b"')).toBe(1);
    expect(html).toContain("Scheduling Laboratory");
  });
  it("15: partial-overlap entries both render", () => {
    const grid = gridOf([entry("a", { start: "08:00", end: "10:00" }), entry("b", { start: "09:00", end: "11:00" })]);
    const html = render(grid);
    expect(count(html, 'data-entry-id="a"')).toBe(1);
    expect(count(html, 'data-entry-id="b"')).toBe(1);
    expect(liBlock(html, "data-entry-id", "a")).toContain('data-overlapping-entry-ids="b"');
    expect(liBlock(html, "data-entry-id", "b")).toContain('data-overlapping-entry-ids="a"');
  });
  it("16: lane positioning honors the grid model", () => {
    const grid = gridOf([
      entry("a", { start: "08:00", end: "10:00" }), entry("b", { start: "09:00", end: "11:00" }),
      entry("c", { start: "10:00", end: "12:00" }),
    ]);
    const html = render(grid);
    for (const [id, lane] of [["a", 0], ["b", 1], ["c", 0]] as const) {
      const block = liBlock(html, "data-entry-id", id);
      expect(block).toContain(`data-lane="${lane}"`);
      expect(block).toContain('data-lane-count="2"');
      expect(block).toContain("width:calc(50% - 0.5rem)");
      expect(block).toContain(`margin-left:calc(${lane * 50}% + 0.25rem)`);
    }
  });
  it("17: an overlap warning appears when hasOverlaps is true", () => {
    const html = render(gridOf([entry("a"), entry("b")]));
    expect(html).toContain('aria-label="Timetable data quality notice"');
    expect(html).toContain("Overlapping sessions are present in the stored published timetable.");
  });
  it("18: no overlap warning appears when hasOverlaps is false", () => {
    const html = render(gridOf([entry("a"), entry("b", { start: "09:00", end: "10:00" })]));
    expect(html).not.toContain('aria-label="Timetable data quality notice"');
    expect(html).not.toContain("Overlapping sessions are present");
  });
  it("19: the warning does not claim M3 validation failed", () => {
    const html = render(gridOf([entry("a"), entry("b")]));
    expect(html).toContain("does not establish a hard-constraint violation");
    for (const claim of ["M3", "validation failed", "hard violations found"]) expect(html).not.toContain(claim);
  });
  it("20: adjacent sessions remain separate", () => {
    const html = render(gridOf([entry("a"), entry("b", { start: "09:00", end: "10:00" })]));
    expect(liBlock(html, "data-entry-id", "a")).toContain("grid-row:1 / 2");
    expect(liBlock(html, "data-entry-id", "b")).toContain("grid-row:2 / 3");
    expect(liBlock(html, "data-entry-id", "a")).toContain('data-overlapping-entry-ids=""');
    expect(html).not.toContain("Time overlap");
  });
  it("21: empty positions are represented accurately", () => {
    const grid = gridOf([entry("m", { start: "09:00", end: "11:00" }), entry("t", { day: "TUE" })]);
    const html = render(grid);
    const mon = dayBlock(html, "MON");
    expect(count(mon, 'data-empty-slot="true"')).toBe(6);
    expect(count(dayBlock(html, "TUE"), 'data-empty-slot="true"')).toBe(7);
    expect(liBlock(mon, "data-slot-id", "slot-0")).toContain("No session");
    expect(liBlock(mon, "data-slot-id", "slot-1")).not.toContain("No session");
    expect(liBlock(mon, "data-slot-id", "slot-2")).not.toContain("No session");
    expect(liBlock(mon, "data-slot-id", "slot-5")).toContain('data-lunch-slot="true"');
  });
  it("22: different day counts work", () => {
    for (const days of [["MON"], ["WED", "MON", "TUE"], ["MON", "TUE", "WED", "THU", "FRI", "SAT"]]) {
      const last = days[days.length - 1];
      const html = render(gridOf([entry("e", { day: last })], { days }));
      expect(count(html, 'data-day="')).toBe(days.length);
      expect(dayBlock(html, last)).toContain('data-entry-id="e"');
    }
  });
  it("23: different scheduling windows work", () => {
    const cases = [
      { over: { slotStart: "09:00", slotEnd: "15:00", lunchStart: "12:00", lunchEnd: "13:00" }, start: "09:00", end: "10:00", slots: 6 },
      { over: { slotStart: "07:00", slotEnd: "18:00", lunchStart: "12:00", lunchEnd: "14:00" }, start: "17:00", end: "18:00", slots: 11 },
    ];
    for (const item of cases) {
      const grid = gridOf([entry("e", { start: item.start, end: item.end })], item.over);
      const html = render(grid);
      expect(count(dayBlock(html, "MON"), 'data-time-slot="')).toBe(item.slots);
      expect(liBlock(html, "data-time-slot", "slot-0")).toContain(item.over.slotStart);
      expect(html).not.toContain(`data-time-slot="slot-${item.slots}"`);
      expect(liBlock(html, "data-entry-id", "e")).toContain(`grid-row:${grid.sessions[0].startSlotIndex + 1} / ${grid.sessions[0].endSlotIndex + 1}`);
    }
  });
  it("24: two-hour lunch periods render", () => {
    const grid = gridOf([], { lunchStart: "12:00", lunchEnd: "14:00" });
    const html = render(grid);
    const lunch = grid.slots.filter((slot) => slot.isLunch);
    expect(lunch.map((slot) => slot.start)).toEqual(["12:00", "13:00"]);
    expect(count(dayBlock(html, "MON"), 'data-lunch-slot="true"')).toBe(2);
    expect(dayBlock(html, "MON")).toContain("Lunch break 12:00–14:00");
  });
  it("25: mobile-responsive structure is present", () => {
    const html = render(gridOf([entry("e")]));
    expect(html).toContain("flex-col");
    expect(html).toContain("lg:flex-row");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("focus:ring-2");
    expect(html).toContain("[scrollbar-color:");
  });
  it("26: essential information is available without color", () => {
    const html = render(gridOf([entry("a"), entry("b")]));
    const text = html.replace(/<[^>]+>/g, " ");
    for (const fact of ["TAMS 101", "Timetabling Foundations", "08:00–09:00", "Lecturer A", "LH1", "Time overlap", "Data quality notice", "Lunch break", "No session"]) {
      expect(text).toContain(fact);
    }
  });
  it("27: stable entry identifiers are used", () => {
    const grid = gridOf([entry("stable-a"), entry("stable-b", { day: "TUE" })]);
    const first = render(grid);
    expect(render(grid)).toBe(first);
    expect(sessionIds(first)).toEqual(["stable-a", "stable-b"]);
  });
  it("28: all sessions appear exactly once in the primary session structure", () => {
    const grid = gridOf([
      entry("a"), entry("b"), entry("c", { day: "TUE", start: "09:00", end: "11:00" }),
      entry("d", { day: "WED", start: "14:00", end: "16:00" }), entry("e", { day: "WED", start: "14:00", end: "15:00" }),
    ]);
    const html = render(grid);
    expect(count(html, 'data-entry-id="')).toBe(grid.sessions.length);
    for (const session of grid.sessions) expect(count(html, `data-entry-id="${session.entryId}"`)).toBe(1);
    expect(sessionIds(html)).toEqual(grid.days.flatMap((day) => grid.sessions.filter((s) => s.dayIndex === day.index).map((s) => s.entryId)));
  });
  it("29: no timetable mutation controls are rendered", () => {
    const html = render(gridOf([entry("e")]));
    expect(html).not.toMatch(/<(form|button|input|select|textarea)[\s>]/i);
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("draggable");
  });
  it("30: no secrets or internal error details are rendered", () => {
    const grid = gridOf([entry("e")]);
    const html = render(grid);
    const session = grid.sessions[0];
    for (const internal of [session.versionId, session.teachingId, session.groupId, session.lecturerId, session.venueId, "INTERNAL_ERROR", "postgres://", "passwordHash", "Stack trace"]) {
      expect(html).not.toContain(internal);
    }
  });
  it("31: no Prisma, publication action or authentication import is introduced", () => {
    const source = readFileSync(join(process.cwd(), "src/app/timetable/PublishedWeekTable.tsx"), "utf8");
    const imports = source.split(/\r?\n/).filter((line) => line.trimStart().startsWith("import"));
    expect(imports).toHaveLength(2);
    for (const line of imports) {
      expect(line).toMatch(/^import type /);
      expect(line).toMatch(/from "@\/(domain\/publishedWeekGrid|server\/publishedTimetableContract)";$/);
    }
    expect(source).not.toContain('"use client"');
    for (const forbidden of ["@prisma", "@/server/db", "publishedTimetableStorePrisma", "draftPublish", "generateActions", "requireUser", "requireAction", "getCurrentUser", "readPublishedTimetable", "next/", "process.env", "console."]) {
      expect(source).not.toContain(forbidden);
    }
  });
  it("32: frozen engine output is rendered without recomputing positions", () => {
    const grid = gridOf([entry("a", { start: "09:00", end: "11:00" }), entry("b", { start: "10:00", end: "12:00" })]);
    const before = JSON.stringify(grid);
    grid.sessions.forEach(Object.freeze);
    Object.freeze(grid.sessions); Object.freeze(grid.days); Object.freeze(grid.slots); Object.freeze(grid);
    const html = render(grid);
    expect(JSON.stringify(grid)).toBe(before);
    for (const session of grid.sessions) {
      const block = liBlock(html, "data-entry-id", session.entryId);
      expect(block).toContain(`data-start-slot-index="${session.startSlotIndex}"`);
      expect(block).toContain(`data-end-slot-index="${session.endSlotIndex}"`);
      expect(block).toContain(`data-lane="${session.lane}"`);
      expect(block).toContain(`data-lane-count="${session.laneCount}"`);
    }
  });
});