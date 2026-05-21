import {
  getVirusTotalDisplayStatus,
  type LlmAnalysis,
  type StaticFinding,
  type VtAnalysis,
} from "./SkillSecurityScanResults";

export type AuditScannerKind = "clawscan" | "virustotal" | "static-analysis";

export const SECURITY_AUDIT_SUBTEXT =
  "Security checks across static analysis, malware telemetry, and agentic risk";

export type StaticScanAnalysis = {
  status: string;
  reasonCodes: string[];
  findings: StaticFinding[];
  summary: string;
  engineVersion: string;
  checkedAt: number;
};

type SecurityAuditSignals = {
  clawScanVerdict?: string | null;
  clawScanState?: string | null;
  vtAnalysis?: VtAnalysis | null;
  llmAnalysis?: LlmAnalysis | null;
  staticScan?: StaticScanAnalysis | null;
  suppressScanResults?: boolean;
};

export const AUDIT_SCANNER_LABELS: Record<AuditScannerKind, string> = {
  clawscan: "Risk analysis",
  virustotal: "VirusTotal",
  "static-analysis": "Static analysis",
};

const DEFAULT_AUDIT_SCANNER_ORDER: AuditScannerKind[] = [
  "static-analysis",
  "virustotal",
  "clawscan",
];

function getStaticScanDisplayStatus(staticScan?: StaticScanAnalysis | null) {
  const status = staticScan?.status?.trim().toLowerCase();
  if (status === "malicious") return "malicious";
  if (status === "suspicious") return "review";
  if (status === "clean" || status === "benign") return "benign";
  if (status) return status;
  return "pending";
}

function getClawScanAuditStatus(signals: SecurityAuditSignals) {
  const verdict = signals.clawScanVerdict?.trim().toLowerCase();
  const state = signals.clawScanState?.trim().toLowerCase();
  if (verdict === "malicious") return "malicious";
  if (state === "pending" || state === "running") return "pending";
  if (state === "error") return "error";
  if (verdict === "benign") return "clean";
  if (verdict === "suspicious") return "review";
  if (verdict === "warning") return "warn";
  if (verdict === "clean" || verdict === "review" || verdict === "warn") return verdict;
  if (state === "complete") return "error";
  // PR2 is deployed only after the PR1 backfill verifies canonical fields.
  // Keep missing canonical values explicit instead of recanonicalizing legacy llmAnalysis.
  return "pending";
}

export function getAuditScannerStatus(kind: AuditScannerKind, signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
  if (kind === "clawscan") return getClawScanAuditStatus(signals);
  if (kind === "virustotal") return getVirusTotalDisplayStatus(signals.vtAnalysis);
  return getStaticScanDisplayStatus(signals.staticScan);
}

export function aggregateAuditVerdict(signals: SecurityAuditSignals) {
  if (signals.suppressScanResults) return "cleared";
  return getAuditScannerStatus("clawscan", signals);
}

export function getSecurityAuditOverviewCopy({
  llmAnalysis,
  clawScanVerdict,
  clawScanState,
  suppressScanResults,
  suppressedMessage,
}: {
  llmAnalysis?: LlmAnalysis | null;
  clawScanVerdict?: string | null;
  clawScanState?: string | null;
  suppressScanResults?: boolean;
  suppressedMessage?: string | null;
}) {
  if (suppressScanResults && suppressedMessage?.trim()) return [suppressedMessage.trim()];
  const verdict = clawScanVerdict?.trim().toLowerCase();
  if (verdict === "malicious") {
    return [
      llmAnalysis?.summary?.trim() || "Risk analysis flagged this release as malicious.",
      llmAnalysis?.guidance?.trim() || null,
    ].filter((copy): copy is string => Boolean(copy));
  }
  const state = clawScanState?.trim().toLowerCase();
  if (state === "pending" || state === "running") return ["Risk analysis is pending."];
  if (state === "error") return ["Risk analysis could not be completed for this release."];
  if (!llmAnalysis) {
    if (verdict === "clean") return ["Risk analysis completed with no visible findings."];
    if (verdict === "review" || verdict === "warn") {
      return ["Risk analysis completed with non-blocking guidance."];
    }
    return ["Risk analysis is pending."];
  }
  return [
    llmAnalysis.summary?.trim() || "No risk analysis has been recorded yet.",
    llmAnalysis?.guidance?.trim() || null,
  ].filter((copy): copy is string => Boolean(copy));
}

export function getAuditScannerOrder() {
  return DEFAULT_AUDIT_SCANNER_ORDER;
}

export function getLatestAuditCheckedAt(signals: SecurityAuditSignals) {
  const values = [
    signals.llmAnalysis?.checkedAt,
    signals.vtAnalysis?.checkedAt,
    signals.staticScan?.checkedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
