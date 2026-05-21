import { describe, expect, it } from "vitest";
import { packageArtifactStatus, skillArtifactStatus } from "./artifactStatus";

describe("artifactStatus", () => {
  it("does not block skills from raw VT or static telemetry after moderation clears them", () => {
    const status = skillArtifactStatus({
      moderationStatus: "active",
      moderationVerdict: "clean",
      moderationFlags: [],
      moderationReason: "pending.scan",
      latestVersion: {
        vtStatus: "malicious",
        llmStatus: "clean",
        staticScanStatus: "malicious",
        clawScanVerdict: "clean",
        clawScanState: "complete",
      },
    });

    expect(status.key).toBe("visible");
    expect(status.scanStatus).toBe("clean");
  });

  it("does not block packages from raw static telemetry after resolved scan status is clean", () => {
    const status = packageArtifactStatus({
      scanStatus: "clean",
      latestRelease: {
        vtStatus: "malicious",
        llmStatus: "clean",
        staticScanStatus: "malicious",
        clawScanVerdict: "clean",
        clawScanState: "complete",
      },
    });

    expect(status.label).toBe("Visible");
    expect(status.scanStatus).toBe("clean");
  });

  it("renders canonical review verdicts without blocking catalog visibility", () => {
    const status = skillArtifactStatus({
      moderationStatus: "active",
      moderationVerdict: "clean",
      moderationFlags: [],
      latestVersion: {
        vtStatus: "clean",
        llmStatus: "suspicious",
        staticScanStatus: "clean",
        clawScanVerdict: "review",
        clawScanState: "complete",
      },
    });

    expect(status.key).toBe("visible");
    expect(status.scanStatus).toBe("review");
  });
});
