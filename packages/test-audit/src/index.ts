import type {
  ChangedSourceCoverage,
  CodeDecayReport,
  FileChange,
  Finding,
  TestEvidenceMode
} from "@submuxhq/codedecay-core";
import { dedupeStrings, sortFindings } from "@submuxhq/codedecay-core";

export type TestProofStatus = "missing" | "weak" | "present" | "not_applicable";

export interface TestProofAudit {
  status: TestProofStatus;
  summary: string;
  evidenceMode: TestEvidenceMode;
  evidenceSummary: string;
  changedSourceFiles: string[];
  changedTestFiles: string[];
  runtimeCoverage: ChangedSourceCoverage[];
  missingTestFindings: Finding[];
  weakTestFindings: Finding[];
  recommendedChecks: string[];
}

const TEST_DIR_NAMES = new Set(["test", "tests", "spec", "specs", "e2e", "integration", "__tests__", "__specs__"]);
const TEST_FILE_STEM_PATTERN = /(^|[._-])(test|spec|e2e|integration)([._-]|$)/i;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const MISSING_TEST_RULES = new Set(["missing-nearby-tests"]);
const WEAK_TEST_RULES = new Set([
  "test-without-assertions",
  "snapshot-only-test",
  "mocked-changed-source",
  "unrelated-test-change",
  "copied-implementation-in-test",
  "happy-path-only-test",
  "heavy-mocking",
  "test-bloat"
]);

export function createTestProofAudit(report: CodeDecayReport): TestProofAudit {
  const changedSourceFiles = report.changedFiles
    .filter((change) => isChangedSourceFile(change))
    .map((change) => change.path)
    .sort((left, right) => left.localeCompare(right));
  const changedTestFiles = report.changedFiles
    .filter((change) => change.status !== "deleted" && isTestPath(change.path))
    .map((change) => change.path)
    .sort((left, right) => left.localeCompare(right));
  const runtimeCoverage = (report.testEvidence?.changedSources ?? []).filter((entry) => changedSourceFiles.includes(entry.path));
  const missingTestFindings = sortFindings(report.findings.filter((finding) => MISSING_TEST_RULES.has(finding.ruleId)));
  const weakTestFindings = sortFindings(report.findings.filter((finding) => WEAK_TEST_RULES.has(finding.ruleId)));
  const status = classifyTestProof({
    changedSourceFiles,
    changedTestFiles,
    runtimeCoverage,
    missingTestFindings,
    weakTestFindings
  });
  const evidenceMode = report.testEvidence?.mode ?? "heuristic_only";

  return {
    status,
    summary: summarizeStatus(status, evidenceMode),
    evidenceMode,
    evidenceSummary: summarizeEvidence(evidenceMode, runtimeCoverage),
    changedSourceFiles,
    changedTestFiles,
    runtimeCoverage,
    missingTestFindings,
    weakTestFindings,
    recommendedChecks: recommendStrongerChecks({
      report,
      status,
      changedSourceFiles,
      changedTestFiles,
      runtimeCoverage,
      missingTestFindings,
      weakTestFindings
    })
  };
}

export function weakTestRuleIds(): string[] {
  return [...WEAK_TEST_RULES].sort((left, right) => left.localeCompare(right));
}

export function missingTestRuleIds(): string[] {
  return [...MISSING_TEST_RULES].sort((left, right) => left.localeCompare(right));
}

function classifyTestProof(input: {
  changedSourceFiles: string[];
  changedTestFiles: string[];
  runtimeCoverage: ChangedSourceCoverage[];
  missingTestFindings: Finding[];
  weakTestFindings: Finding[];
}): TestProofStatus {
  if (input.changedSourceFiles.length === 0 && input.changedTestFiles.length === 0 && input.runtimeCoverage.length === 0) {
    return "not_applicable";
  }

  if (input.runtimeCoverage.some((entry) => entry.status === "not_covered")) {
    return "missing";
  }

  if (input.runtimeCoverage.some((entry) => entry.status === "partial")) {
    return "weak";
  }

  if (input.runtimeCoverage.length > 0 && input.changedSourceFiles.length > 0) {
    const measuredSourceCount = input.runtimeCoverage.filter((entry) => entry.status !== "not_measured").length;
    if (measuredSourceCount === input.changedSourceFiles.length) {
      return input.weakTestFindings.length > 0 ? "weak" : "present";
    }
  }

  if (input.missingTestFindings.length > 0 || (input.changedSourceFiles.length > 0 && input.changedTestFiles.length === 0)) {
    return "missing";
  }

  if (input.weakTestFindings.length > 0) {
    return "weak";
  }

  return "present";
}

function summarizeStatus(status: TestProofStatus, evidenceMode: TestEvidenceMode): string {
  if (status === "missing") {
    return evidenceMode === "runtime_augmented"
      ? "Changed source behavior is missing runtime-backed test evidence for at least one changed path."
      : "Changed source behavior does not have enough nearby test evidence.";
  }

  if (status === "weak") {
    return evidenceMode === "runtime_augmented"
      ? "Changed behavior has partial runtime coverage or weak deterministic test signals."
      : "Changed tests exist, but deterministic rules found weak test-evidence signals.";
  }

  if (status === "present") {
    return evidenceMode === "runtime_augmented"
      ? "Runtime coverage artifacts include the changed source lines and no weak deterministic signals were found."
      : "Changed tests are present and no deterministic weak-test signals were found.";
  }

  return "No changed source or test files require a test-evidence audit.";
}

function summarizeEvidence(mode: TestEvidenceMode, runtimeCoverage: ChangedSourceCoverage[]): string {
  if (mode === "heuristic_only") {
    return "Heuristic-only audit. No runtime coverage artifact was found for changed source files.";
  }

  const covered = runtimeCoverage.filter((entry) => entry.status === "covered").length;
  const partial = runtimeCoverage.filter((entry) => entry.status === "partial").length;
  const missing = runtimeCoverage.filter((entry) => entry.status === "not_covered").length;
  const notMeasured = runtimeCoverage.filter((entry) => entry.status === "not_measured").length;
  return `Runtime coverage artifacts were found. Covered: ${covered}, partial: ${partial}, uncovered: ${missing}, not measured: ${notMeasured}.`;
}

function recommendStrongerChecks(input: {
  report: CodeDecayReport;
  status: TestProofStatus;
  changedSourceFiles: string[];
  changedTestFiles: string[];
  runtimeCoverage: ChangedSourceCoverage[];
  missingTestFindings: Finding[];
  weakTestFindings: Finding[];
}): string[] {
  const checks: string[] = [];

  if (input.status === "missing") {
    for (const file of input.changedSourceFiles.slice(0, 8)) {
      checks.push(`Add or run tests that exercise ${file} through its public behavior path.`);
    }
  }

  for (const finding of [...input.missingTestFindings, ...input.weakTestFindings]) {
    checks.push(strongerCheckForFinding(finding));
  }

  for (const entry of input.runtimeCoverage) {
    if (entry.status === "not_covered") {
      checks.push(`Run or add tests that execute the changed lines in ${entry.path}.`);
    }

    if (entry.status === "partial") {
      const uncovered = entry.uncoveredLines.length > 0 ? ` (${entry.uncoveredLines.join(", ")})` : "";
      checks.push(`Add runtime coverage for uncovered changed lines in ${entry.path}${uncovered}.`);
    }
  }

  checks.push(...input.report.recommendedTests.filter(isTestProofRecommendation).map(normalizeRecommendedCheck));

  if (input.status === "weak" && input.changedTestFiles.length > 0) {
    for (const file of input.changedTestFiles.slice(0, 4)) {
      checks.push(`Strengthen ${file} with assertions, negative cases, and real-boundary coverage.`);
    }
  }

  return dedupeStrings(checks);
}

function strongerCheckForFinding(finding: Finding): string {
  if (finding.ruleId === "test-without-assertions") {
    return `Add meaningful assertions to ${finding.file ?? "the changed test"}.`;
  }

  if (finding.ruleId === "snapshot-only-test") {
    return `Add explicit behavior assertions alongside snapshots in ${finding.file ?? "the changed test"}.`;
  }

  if (finding.ruleId === "mocked-changed-source") {
    return `Exercise the changed module through a real boundary instead of mocking it in ${finding.file ?? "the changed test"}.`;
  }

  if (finding.ruleId === "copied-implementation-in-test") {
    return `Replace copied implementation assertions with externally visible behavior checks in ${finding.file ?? "the changed test"}.`;
  }

  if (finding.ruleId === "happy-path-only-test") {
    return `Add negative, malformed, missing, or boundary-value cases in ${finding.file ?? "the changed test"}.`;
  }

  if (finding.ruleId === "heavy-mocking") {
    return `Reduce mock-only confidence by adding a real-module or integration check for ${finding.file ?? "the changed test"}.`;
  }

  if (finding.ruleId === "test-bloat") {
    return `Confirm large test changes in ${finding.file ?? "the changed test"} prove behavior and are not only fixture or mock expansion.`;
  }

  return finding.description;
}

function isChangedSourceFile(change: FileChange): boolean {
  return change.status !== "deleted" && isSourcePath(change.path) && !isTestPath(change.path) && !isDocsPath(change.path);
}

function isSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extensionOf(path));
}

function isTestPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const directorySegments = segments.slice(0, -1);
  if (directorySegments.some((segment) => TEST_DIR_NAMES.has(segment))) {
    return true;
  }

  const fileName = segments.at(-1) ?? normalized;
  return TEST_FILE_STEM_PATTERN.test(stripExtension(fileName));
}

function isDocsPath(path: string): boolean {
  return /(^|\/)(docs?|readme|changelog|license)(\/|\.|$)/i.test(path) || /\.(md|mdx|txt)$/i.test(path);
}

function extensionOf(path: string): string {
  const match = /\.[^.\/]+$/.exec(path);
  return match?.[0].toLowerCase() ?? "";
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.]+$/, "");
}

function isTestProofRecommendation(value: string): boolean {
  return /assertion|snapshot|integration|real-module|public API|negative|edge-case|exercise|test|spec|e2e/i.test(value);
}

function normalizeRecommendedCheck(value: string): string {
  const trimmed = value.trim();
  if (isPathLikeRecommendation(trimmed)) {
    return `Run or strengthen ${trimmed} with assertions, negative cases, and real-boundary coverage.`;
  }

  return trimmed;
}

function isPathLikeRecommendation(value: string): boolean {
  const hasNoWhitespace = value.split(/\s+/).length === 1;
  const hasDirectorySeparator = value.includes("/") || value.includes("\\");
  const hasFileExtension = /\.[a-z0-9]+$/i.test(value);
  const hasOnlyPathCharacters = /^[a-z0-9._/-]+$/i.test(value);

  return hasNoWhitespace && hasDirectorySeparator && hasFileExtension && hasOnlyPathCharacters;
}
