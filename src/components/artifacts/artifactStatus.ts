export type ArtifactDisplayStatus = {
  key?: string;
  label: string;
  description: string;
  scanStatus: string;
  variant: "default" | "pending" | "warning" | "destructive" | "success";
};

type ArtifactScanSignalStatus = "clean" | "suspicious" | "malicious" | null;
type ClawScanVerdict = "clean" | "review" | "warn" | "malicious";
type ClawScanState = "pending" | "running" | "complete" | "error";

type SkillArtifactStatusInput = {
  moderationStatus?: string;
  moderationReason?: string;
  moderationVerdict?: "clean" | "malicious";
  moderationFlags?: string[];
  pendingReview?: boolean;
  qualityDecision?: "pass" | "quarantine" | "reject";
  latestVersion?: {
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: ArtifactScanSignalStatus;
    clawScanVerdict?: ClawScanVerdict | null;
    clawScanState?: ClawScanState | null;
  } | null;
};

type PackageArtifactStatusInput = {
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
  pendingReview?: boolean;
  latestRelease?: {
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: ArtifactScanSignalStatus;
    clawScanVerdict?: ClawScanVerdict | null;
    clawScanState?: ClawScanState | null;
  } | null;
};

export function artifactStatusToScanStatus(
  status: Pick<ArtifactDisplayStatus, "key" | "label" | "scanStatus">,
) {
  if (status.scanStatus) return status.scanStatus;
  if (status.key === "blocked" || status.label === "Blocked") return "malicious";
  if (status.key === "visible" || status.label === "Visible") return "clean";
  if (status.key === "pending" || status.label === "Pending checks") return "pending";
  return "unknown";
}

function getClawScanBadgeStatus(
  scan:
    | {
        clawScanVerdict?: ClawScanVerdict | null;
        clawScanState?: ClawScanState | null;
      }
    | null
    | undefined,
  fallback?: string | null,
) {
  const verdict = scan?.clawScanVerdict ?? null;
  const state = scan?.clawScanState ?? null;

  if (verdict === "malicious") return "malicious";
  if (state === "pending" || state === "running") return "pending";
  if (state === "error") return "error";
  if (verdict) return verdict;
  if (state === "complete") return "error";
  if (fallback === "malicious" || fallback === "pending" || fallback === "not-run") {
    return fallback === "not-run" ? "pending" : fallback;
  }
  if (fallback === "clean") return "clean";
  return "unknown";
}

export function skillArtifactStatus(skill: SkillArtifactStatusInput): ArtifactDisplayStatus & {
  key: "visible" | "pending" | "blocked" | "hidden" | "removed" | "quality";
} {
  const flags = skill.moderationFlags ?? [];
  const reason = skill.moderationReason ?? "";
  const scanStatus = getClawScanBadgeStatus(skill.latestVersion);

  if (skill.moderationStatus === "removed") {
    return {
      key: "removed",
      label: "Removed",
      description: "Removed from public inventory by moderation.",
      scanStatus,
      variant: "destructive",
    };
  }
  if (
    flags.includes("blocked.malware") ||
    skill.moderationVerdict === "malicious" ||
    skill.latestVersion?.clawScanVerdict === "malicious"
  ) {
    return {
      key: "blocked",
      label: "Blocked",
      description:
        "Unavailable publicly because automated security checks found malicious content.",
      scanStatus: "malicious",
      variant: "destructive",
    };
  }
  if (
    skill.qualityDecision === "quarantine" ||
    skill.qualityDecision === "reject" ||
    reason === "quality.low"
  ) {
    return {
      key: "quality",
      label: "Quality held",
      description: "Unavailable while quality review is holding this release.",
      scanStatus,
      variant: "warning",
    };
  }
  if (skill.moderationStatus === "hidden") {
    return {
      key: "hidden",
      label: "Hidden",
      description: "Hidden from public catalog surfaces.",
      scanStatus,
      variant: "warning",
    };
  }
  return {
    key: "visible",
    label: "Visible",
    description: "Available on public catalog surfaces.",
    scanStatus,
    variant: "success",
  };
}

export function packageArtifactStatus(pkg: PackageArtifactStatusInput): ArtifactDisplayStatus {
  const scanStatus = getClawScanBadgeStatus(pkg.latestRelease, pkg.scanStatus);

  if (pkg.scanStatus === "malicious" || pkg.latestRelease?.clawScanVerdict === "malicious") {
    return {
      label: "Blocked",
      description: "Security checks found malicious content.",
      scanStatus: "malicious",
      variant: "destructive",
    };
  }
  return {
    label: "Visible",
    description: "Available on public catalog surfaces.",
    scanStatus,
    variant: "success",
  };
}
