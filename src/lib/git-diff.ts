export type GitFileDiffStatus = "added" | "modified" | "deleted" | "renamed";

export type GitFileDiff = {
  path: string;
  additions: number;
  deletions: number;
  status: GitFileDiffStatus;
};

export type GitDiffStats = {
  isGitRepo: boolean;
  hasChanges?: boolean;
  totalAdditions?: number;
  totalDeletions?: number;
  files?: GitFileDiff[];
  error?: string | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

function firstDefined(record: UnknownRecord, snakeCase: string, camelCase: string): unknown {
  return record[snakeCase] ?? record[camelCase];
}

function numberOrZero(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeStatus(value: unknown): GitFileDiffStatus {
  return value === "added" || value === "deleted" || value === "renamed" ? value : "modified";
}

/** Normalize Rust/Tauri or compatibility Web API git-diff payloads. */
export function normalizeGitDiffStats(value: unknown): GitDiffStats {
  const record = asRecord(value);
  const rawFiles = record.files;
  const files = Array.isArray(rawFiles)
    ? rawFiles.map((entry) => {
        const file = asRecord(entry);
        return {
          path: String(file.path ?? ""),
          additions: numberOrZero(file.additions),
          deletions: numberOrZero(file.deletions),
          status: normalizeStatus(file.status),
        };
      })
    : [];
  const error = record.error;
  return {
    isGitRepo: Boolean(firstDefined(record, "is_git_repo", "isGitRepo")),
    hasChanges: Boolean(firstDefined(record, "has_changes", "hasChanges")),
    totalAdditions: numberOrZero(firstDefined(record, "total_additions", "totalAdditions")),
    totalDeletions: numberOrZero(firstDefined(record, "total_deletions", "totalDeletions")),
    files,
    error: typeof error === "string" ? error : null,
  };
}
