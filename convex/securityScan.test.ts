import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelQueuedVtUpdateJobsInternal,
  claimCodexScanJobs,
  enqueuePackageReleaseScanInternal,
  enqueueSkillVersionScanInternal,
  failCodexScanJob,
  failJobInternal,
} from "./securityScan";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const claimCodexScanJobsHandler = (
  claimCodexScanJobs as unknown as WrappedHandler<
    { token: string; workerId: string; limit?: number },
    Array<unknown>
  >
)._handler;

const failCodexScanJobHandler = (
  failCodexScanJob as unknown as WrappedHandler<
    { token: string; jobId: string; leaseToken: string; error: string },
    { ok: true; retry: boolean }
  >
)._handler;

const failJobInternalHandler = (
  failJobInternal as unknown as WrappedHandler<
    { jobId: string; leaseToken: string; error: string },
    { ok: true; retry: boolean }
  >
)._handler;

type CancelArgs = {
  dryRun: boolean;
  createdBefore: number;
  scanLimit?: number;
  deleteLimit?: number;
};

type CancelResult = {
  dryRun: boolean;
  scanned: number;
  matched: number;
  deleted: number;
  wouldDelete: number;
  skippedByReason: Record<string, number>;
  oldestScannedCreatedAt: number | null;
  newestScannedCreatedAt: number | null;
  oldestScannedNextRunAt: number | null;
  newestScannedNextRunAt: number | null;
  sampleMatchedJobIds: string[];
  sampleDeletedJobIds: string[];
};

type ScanJob = {
  _id: string;
  _creationTime: number;
  status: string;
  targetKind: string;
  skillVersionId?: string;
  packageReleaseId?: string;
  source: string;
  priority: number;
  hasMaliciousSignal: boolean;
  waitForVtUntil: number;
  nextRunAt: number;
  attempts: number;
  leaseToken?: string;
  createdAt: number;
  updatedAt: number;
};

const cancelQueuedVtUpdateJobsInternalHandler = (
  cancelQueuedVtUpdateJobsInternal as unknown as WrappedHandler<CancelArgs, CancelResult>
)._handler;

const enqueueSkillVersionScanInternalHandler = (
  enqueueSkillVersionScanInternal as unknown as WrappedHandler<
    { versionId: string; source: string; priority?: number; waitForVtMs?: number },
    { ok: true; jobId?: string; alreadyQueued?: boolean; skipped?: string }
  >
)._handler;

const enqueuePackageReleaseScanInternalHandler = (
  enqueuePackageReleaseScanInternal as unknown as WrappedHandler<
    { releaseId: string; source: string; priority?: number; waitForVtMs?: number },
    { ok: true; jobId?: string; alreadyQueued?: boolean; skipped?: string }
  >
)._handler;

const claimedJob = {
  _id: "securityScanJobs:1",
  _creationTime: 1,
  status: "running",
  targetKind: "skillVersion",
  skillVersionId: "skillVersions:1",
  source: "publish",
  priority: 0,
  hasMaliciousSignal: true,
  waitForVtUntil: 0,
  nextRunAt: 0,
  attempts: 1,
  leaseToken: "lease-token",
};

function makeScanJob(overrides: Partial<ScanJob> = {}): ScanJob {
  const suffix = (overrides._id ?? "matched").split(":").at(-1) ?? "matched";
  return {
    _id: `securityScanJobs:${suffix}`,
    _creationTime: 1,
    status: "queued",
    targetKind: "skillVersion",
    skillVersionId: `skillVersions:${suffix}`,
    source: "vt-update",
    priority: 0,
    hasMaliciousSignal: false,
    waitForVtUntil: 0,
    nextRunAt: 100,
    attempts: 0,
    createdAt: 50,
    updatedAt: 50,
    ...overrides,
  };
}

function makeTarget(llmStatus?: string) {
  if (!llmStatus) return {};
  return {
    llmAnalysis: {
      status: llmStatus,
      checkedAt: 123,
    },
  };
}

function makeCancelCtx(jobs: ScanJob[], targets: Map<string, unknown> = new Map()) {
  const deleted: string[] = [];
  const deleteDoc = vi.fn(async (id: string) => {
    deleted.push(id);
  });
  const get = vi.fn(async (id: string) => targets.get(id) ?? null);
  const noopWrite = vi.fn(async () => undefined);
  const patch = vi.fn(async () => undefined);
  const take = vi.fn(async (limit: number) => jobs.slice(0, limit));
  const order = vi.fn(() => ({ take }));
  const indexBuilder: {
    eq: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => indexBuilder),
    lt: vi.fn(() => indexBuilder),
  };
  const withIndex = vi.fn((indexName: string, buildRange: (q: typeof indexBuilder) => unknown) => {
    expect(indexName).toBe("by_status_source_created_at");
    buildRange(indexBuilder);
    expect(indexBuilder.eq).toHaveBeenCalledWith("status", "queued");
    expect(indexBuilder.eq).toHaveBeenCalledWith("source", "vt-update");
    expect(indexBuilder.lt).toHaveBeenCalledWith("createdAt", 1000);
    return { order };
  });
  const query = vi.fn((tableName: string) => {
    expect(tableName).toBe("securityScanJobs");
    return { withIndex };
  });

  return {
    ctx: {
      db: {
        query,
        get,
        delete: deleteDoc,
        insert: noopWrite,
        patch,
        replace: noopWrite,
        normalizeId: vi.fn(() => null),
        system: {},
      },
    },
    deleted,
    deleteDoc,
    patch,
    get,
    take,
  };
}

function makeEnqueueCtx(target: Record<string, unknown>, jobs: Array<Record<string, unknown>>) {
  const patch = vi.fn(async () => undefined);
  const insert = vi.fn(async () => "securityScanJobs:new");
  const collect = vi.fn(async () => jobs);
  const withIndex = vi.fn((_indexName: string, buildRange: (q: unknown) => unknown) => {
    const q = { eq: vi.fn(() => q) };
    buildRange(q);
    return { collect };
  });
  const query = vi.fn(() => ({ withIndex }));
  return {
    ctx: {
      db: {
        get: vi.fn(async () => target),
        query,
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
      },
    },
    patch,
    insert,
  };
}

describe("securityScan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails claimed jobs when an artifact file URL is unavailable", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      version: {
        files: [
          {
            path: "SKILL.md",
            size: 12,
            sha256: "a".repeat(64),
            storageId: "storage:skill",
          },
          {
            path: "payload.js",
            size: 24,
            sha256: "b".repeat(64),
            storageId: "storage:missing",
          },
        ],
      },
    }));
    const getUrl = vi.fn(async (storageId: string) =>
      storageId === "storage:skill" ? "https://storage.example/SKILL.md" : null,
    );

    const result = await claimCodexScanJobsHandler(
      { runMutation, runQuery, storage: { getUrl } },
      { token: "worker-secret", workerId: "worker-1", limit: 10 },
    );

    expect(result).toEqual([]);
    expect(runMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Artifact file unavailable: payload.js",
      }),
    );
  });

  it("fails claimed package jobs when the ClawPack URL is unavailable", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      release: {
        files: [],
        clawpackStorageId: "storage:clawpack",
      },
    }));
    const getUrl = vi.fn(async () => null);

    const result = await claimCodexScanJobsHandler(
      { runMutation, runQuery, storage: { getUrl } },
      { token: "worker-secret", workerId: "worker-1", limit: 10 },
    );

    expect(result).toEqual([]);
    expect(runMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "ClawPack artifact unavailable",
      }),
    );
  });

  it("persists an error ClawScan result when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "skillVersion",
      },
      version: {
        _id: "skillVersions:1",
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error:
          "Download failed https://signed.example.invalid/file?token=secret Authorization: Bearer sk-short-secret OPENAI_API_KEY=sk-short-secret",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:1",
        moderationMode: "preserve",
        llmAnalysis: expect.objectContaining({
          confidence: "low",
          status: "error",
          summary: expect.stringContaining("could not complete"),
        }),
      }),
    );
    const llmAnalysis = runMutation.mock.calls[1]?.[1]?.llmAnalysis as
      | { findings?: string }
      | undefined;
    expect(llmAnalysis?.findings).toContain("Worker error");
    expect(llmAnalysis?.findings).not.toContain("token=secret");
    expect(llmAnalysis?.findings).not.toContain("sk-short-secret");
  });

  it("returns the target ClawScan state to pending when a job will retry", async () => {
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: {
        get: vi.fn(async () =>
          makeScanJob({
            _id: "securityScanJobs:retry",
            status: "running",
            attempts: 1,
            leaseToken: "lease-token",
          }),
        ),
        patch,
        query: vi.fn(),
        insert: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        replace: vi.fn(async () => undefined),
        normalizeId: vi.fn(() => null),
        system: {},
      },
    };

    const result = await failJobInternalHandler(ctx, {
      jobId: "securityScanJobs:retry",
      leaseToken: "lease-token",
      error: "temporary failure",
    });

    expect(result).toEqual({ ok: true, retry: true });
    expect(patch).toHaveBeenNthCalledWith(
      1,
      "securityScanJobs:retry",
      expect.objectContaining({ status: "queued" }),
    );
    expect(patch).toHaveBeenNthCalledWith(2, "skillVersions:retry", {
      clawScanState: "pending",
    });
  });

  it("marks package-release ClawScan state as error when retries are exhausted", async () => {
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: {
        get: vi.fn(async () =>
          makeScanJob({
            _id: "securityScanJobs:exhausted",
            status: "running",
            targetKind: "packageRelease",
            skillVersionId: undefined,
            packageReleaseId: "packageReleases:exhausted",
            attempts: 3,
            leaseToken: "lease-token",
          }),
        ),
        patch,
        query: vi.fn(),
        insert: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        replace: vi.fn(async () => undefined),
        normalizeId: vi.fn(() => null),
        system: {},
      },
    };

    const result = await failJobInternalHandler(ctx, {
      jobId: "securityScanJobs:exhausted",
      leaseToken: "lease-token",
      error: "permanent failure",
    });

    expect(result).toEqual({ ok: true, retry: false });
    expect(patch).toHaveBeenNthCalledWith(
      1,
      "securityScanJobs:exhausted",
      expect.objectContaining({ status: "failed" }),
    );
    expect(patch).toHaveBeenNthCalledWith(2, "packageReleases:exhausted", {
      clawScanState: "error",
    });
  });

  it("preserves running skill-version ClawScan state when re-enqueuing an active job", async () => {
    const { ctx, patch, insert } = makeEnqueueCtx(
      { _id: "skillVersions:running", staticScan: undefined, vtAnalysis: undefined },
      [
        {
          _id: "securityScanJobs:running",
          status: "running",
          priority: 1,
          hasMaliciousSignal: false,
          waitForVtUntil: 100,
          nextRunAt: 100,
        },
      ],
    );

    const result = await enqueueSkillVersionScanInternalHandler(ctx, {
      versionId: "skillVersions:running",
      source: "manual",
      priority: 100,
      waitForVtMs: 0,
    });

    expect(result).toEqual({
      ok: true,
      jobId: "securityScanJobs:running",
      alreadyQueued: true,
    });
    expect(patch).toHaveBeenCalledWith("skillVersions:running", { clawScanState: "running" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("preserves running package-release ClawScan state when re-enqueuing an active job", async () => {
    const { ctx, patch, insert } = makeEnqueueCtx(
      { _id: "packageReleases:running", staticScan: undefined, vtAnalysis: undefined },
      [
        {
          _id: "securityScanJobs:running-package",
          status: "running",
          priority: 1,
          hasMaliciousSignal: false,
          waitForVtUntil: 100,
          nextRunAt: 100,
        },
      ],
    );

    const result = await enqueuePackageReleaseScanInternalHandler(ctx, {
      releaseId: "packageReleases:running",
      source: "manual",
      priority: 100,
      waitForVtMs: 0,
    });

    expect(result).toEqual({ ok: true, jobId: "securityScanJobs:running-package" });
    expect(patch).toHaveBeenCalledWith("packageReleases:running", {
      clawScanState: "running",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("preserves a prior blocking skill ClawScan verdict when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "skillVersion",
      },
      version: {
        _id: "skillVersions:1",
        llmAnalysis: {
          status: "suspicious",
          checkedAt: 123,
        },
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Codex worker failed",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("preserves a prior blocking package ClawScan verdict when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "packageRelease",
      },
      release: {
        _id: "packageReleases:1",
        llmAnalysis: {
          status: "error",
          verdict: "malicious",
          checkedAt: 123,
        },
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Codex worker failed",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("preserves a prior clean package ClawScan verdict when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "packageRelease",
      },
      release: {
        _id: "packageReleases:1",
        llmAnalysis: {
          status: "clean",
          verdict: "benign",
          checkedAt: 123,
        },
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Codex worker failed",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("dry-runs queued vt-update jobs without deleting", async () => {
    const job = makeScanJob({ _id: "securityScanJobs:dry-run" });
    const { ctx, deleteDoc, take } = makeCancelCtx(
      [job],
      new Map<string, unknown>([["skillVersions:dry-run", makeTarget("clean")]]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: true,
      createdBefore: 1000,
    });

    expect(take).toHaveBeenCalledWith(1000);
    expect(result).toMatchObject({
      dryRun: true,
      scanned: 1,
      matched: 1,
      wouldDelete: 1,
      deleted: 0,
      oldestScannedCreatedAt: 50,
      newestScannedCreatedAt: 50,
      oldestScannedNextRunAt: 100,
      newestScannedNextRunAt: 100,
      skippedByReason: {},
      sampleMatchedJobIds: ["securityScanJobs:dry-run"],
      sampleDeletedJobIds: [],
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("deletes all queued vt-update jobs while preserving other sources and running jobs", async () => {
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:clean" }),
      makeScanJob({
        _id: "securityScanJobs:package",
        targetKind: "packageRelease",
        skillVersionId: undefined,
        packageReleaseId: "packageReleases:package",
      }),
      makeScanJob({
        _id: "securityScanJobs:malicious-signal",
        hasMaliciousSignal: true,
      }),
      makeScanJob({ _id: "securityScanJobs:vt-mismatch" }),
      makeScanJob({ _id: "securityScanJobs:no-llm" }),
      makeScanJob({ _id: "securityScanJobs:publish", source: "publish" }),
      makeScanJob({ _id: "securityScanJobs:manual", source: "manual" }),
      makeScanJob({ _id: "securityScanJobs:clawscan-note", source: "clawscan-note" }),
      makeScanJob({ _id: "securityScanJobs:backfill", source: "backfill" }),
      makeScanJob({ _id: "securityScanJobs:running", status: "running" }),
    ];
    const { ctx, deleted, get } = makeCancelCtx(
      jobs,
      new Map<string, unknown>([
        ["skillVersions:clean", makeTarget("clean")],
        ["packageReleases:package", makeTarget("clean")],
        ["skillVersions:malicious-signal", makeTarget("clean")],
        ["skillVersions:vt-mismatch", makeTarget("clean")],
        ["skillVersions:no-llm", makeTarget()],
        ["skillVersions:running", makeTarget("clean")],
      ]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: false,
      createdBefore: 1000,
      scanLimit: 25,
      deleteLimit: 10,
    });

    expect(deleted).toEqual([
      "securityScanJobs:clean",
      "securityScanJobs:package",
      "securityScanJobs:vt-mismatch",
    ]);
    expect(get).toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: false,
      scanned: 10,
      matched: 3,
      wouldDelete: 3,
      deleted: 3,
      skippedByReason: {
        "not-vt-update": 4,
        "not-queued-vt-update": 1,
        "malicious-signal": 1,
        "missing-llm-analysis": 1,
      },
      sampleMatchedJobIds: [
        "securityScanJobs:clean",
        "securityScanJobs:package",
        "securityScanJobs:vt-mismatch",
      ],
      sampleDeletedJobIds: [
        "securityScanJobs:clean",
        "securityScanJobs:package",
        "securityScanJobs:vt-mismatch",
      ],
    });
  });

  it("treats legacy suspicious LLM status as final for stale vt-update cleanup", async () => {
    const job = makeScanJob({ _id: "securityScanJobs:legacy-suspicious" });
    const { ctx, deleted } = makeCancelCtx(
      [job],
      new Map<string, unknown>([["skillVersions:legacy-suspicious", makeTarget("suspicious")]]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: false,
      createdBefore: 1000,
      scanLimit: 10,
      deleteLimit: 10,
    });

    expect(deleted).toEqual(["securityScanJobs:legacy-suspicious"]);
    expect(result).toMatchObject({
      matched: 1,
      deleted: 1,
      skippedByReason: {},
      sampleMatchedJobIds: ["securityScanJobs:legacy-suspicious"],
      sampleDeletedJobIds: ["securityScanJobs:legacy-suspicious"],
    });
  });

  it("marks targets complete when deleting stale vt-update jobs with final ClawScan results", async () => {
    const skillJob = makeScanJob({ _id: "securityScanJobs:clean" });
    const packageJob = makeScanJob({
      _id: "securityScanJobs:package",
      targetKind: "packageRelease",
      skillVersionId: undefined,
      packageReleaseId: "packageReleases:package",
    });
    const { ctx, patch } = makeCancelCtx(
      [skillJob, packageJob],
      new Map<string, unknown>([
        ["skillVersions:clean", makeTarget("benign")],
        ["packageReleases:package", makeTarget("clean")],
      ]),
    );

    await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: false,
      createdBefore: 1000,
      scanLimit: 10,
      deleteLimit: 10,
    });

    expect(patch).toHaveBeenCalledWith("skillVersions:clean", { clawScanState: "complete" });
    expect(patch).toHaveBeenCalledWith("packageReleases:package", {
      clawScanState: "complete",
    });
  });

  it("counts matched jobs beyond the per-run delete limit without deleting them", async () => {
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:first" }),
      makeScanJob({ _id: "securityScanJobs:second" }),
    ];
    const { ctx, deleted } = makeCancelCtx(
      jobs,
      new Map<string, unknown>([
        ["skillVersions:first", makeTarget("clean")],
        ["skillVersions:second", makeTarget("clean")],
      ]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: false,
      createdBefore: 1000,
      deleteLimit: 1,
    });

    expect(deleted).toEqual(["securityScanJobs:first"]);
    expect(result).toMatchObject({
      scanned: 2,
      matched: 2,
      wouldDelete: 1,
      deleted: 1,
      skippedByReason: {
        "delete-limit-reached": 1,
      },
      sampleMatchedJobIds: ["securityScanJobs:first", "securityScanJobs:second"],
      sampleDeletedJobIds: ["securityScanJobs:first"],
    });
  });
});
