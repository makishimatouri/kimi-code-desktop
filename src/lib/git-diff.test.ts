import { describe, expect, it } from "vitest";
import { normalizeGitDiffStats } from "./git-diff";

describe("normalizeGitDiffStats", () => {
  it("normalizes the Rust snake_case payload", () => {
    expect(
      normalizeGitDiffStats({
        is_git_repo: true,
        has_changes: true,
        total_additions: 12,
        total_deletions: 3,
        files: [{ path: "src/app.tsx", additions: 12, deletions: 3, status: "modified" }],
        error: null,
      }),
    ).toEqual({
      isGitRepo: true,
      hasChanges: true,
      totalAdditions: 12,
      totalDeletions: 3,
      files: [{ path: "src/app.tsx", additions: 12, deletions: 3, status: "modified" }],
      error: null,
    });
  });

  it("accepts the camelCase compatibility shape and bounds unknown values", () => {
    expect(
      normalizeGitDiffStats({
        isGitRepo: true,
        totalAdditions: "not-a-number",
        files: [{ path: "binary.dat", additions: "4", deletions: null, status: "unknown" }],
      }),
    ).toMatchObject({
      isGitRepo: true,
      totalAdditions: 0,
      files: [{ path: "binary.dat", additions: 4, deletions: 0, status: "modified" }],
    });
  });
});
