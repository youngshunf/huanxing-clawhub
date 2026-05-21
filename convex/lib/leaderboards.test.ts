import { describe, expect, it } from "vitest";
/* @vitest-environment node */
import type { Id } from "../_generated/dataModel";
import { takeTopTrendingEntries, type LeaderboardEntry } from "./leaderboards";

describe("takeTopTrendingEntries", () => {
  it("keeps the highest scoring entries without suspicious filtering", () => {
    const skillId = (value: string) => value as Id<"skills">;
    const entries: LeaderboardEntry[] = [
      { skillId: skillId("skills:review"), score: 300, installs: 300, downloads: 10 },
      { skillId: skillId("skills:warn"), score: 200, installs: 200, downloads: 9 },
      { skillId: skillId("skills:clean"), score: 100, installs: 100, downloads: 8 },
    ];

    const items = takeTopTrendingEntries(entries, 1);

    expect(items).toEqual([
      { skillId: skillId("skills:review"), score: 300, installs: 300, downloads: 10 },
    ]);
  });
});
