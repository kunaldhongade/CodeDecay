import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface BenchmarkCase {
  id: string;
  setup: () => string;
  expectedRiskLevel: "low" | "medium" | "high";
  mergeRiskMin: number;
  mergeRiskMax: number;
  expectedRules: string[];
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("public risk benchmark corpus", () => {
  const benchmarks: BenchmarkCase[] = [
    {
      id: "broad-low-signal-mixed-change",
      setup: createBroadLowOnlyRepo,
      expectedRiskLevel: "low",
      mergeRiskMin: 0,
      mergeRiskMax: 39,
      expectedRules: ["risky-docs-change"]
    },
    {
      id: "api-handler-behavior-change",
      setup: createMediumRiskRepo,
      expectedRiskLevel: "medium",
      mergeRiskMin: 40,
      mergeRiskMax: 69,
      expectedRules: ["risky-api-change"]
    },
    {
      id: "auth-api-schema-regression",
      setup: createHighRiskRepo,
      expectedRiskLevel: "high",
      mergeRiskMin: 70,
      mergeRiskMax: 100,
      expectedRules: ["risky-auth-change", "risky-database-change"]
    }
  ];

  for (const benchmark of benchmarks) {
    it(benchmark.id, async () => {
      const repo = benchmark.setup();
      const result = await run(["analyze", "--format", "json"], repo);
      const report = JSON.parse(result.stdout) as {
        summary: { riskLevel: string; mergeRiskScore: number };
        findings: Array<{ ruleId: string }>;
      };

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(report.summary.riskLevel).toBe(benchmark.expectedRiskLevel);
      expect(report.summary.mergeRiskScore).toBeGreaterThanOrEqual(benchmark.mergeRiskMin);
      expect(report.summary.mergeRiskScore).toBeLessThanOrEqual(benchmark.mergeRiskMax);

      for (const ruleId of benchmark.expectedRules) {
        expect(report.findings.map((finding) => finding.ruleId)).toContain(ruleId);
      }
    });
  }
});

async function run(args: string[], cwd: string): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    cwd,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    }
  });

  return { exitCode, stdout, stderr };
}

function createBroadLowOnlyRepo(): string {
  const repo = createRepo({
    "README.md": "# Project\n"
  });

  const files = [
    "docs/agent.md",
    "docs/getting-started.md",
    "docs/mcp.md",
    "docs/reports.md",
    "docs/scoring.md",
    "docs/examples/sample-report.md",
    "docs/examples/json-report.md",
    "docs/examples/sarif-report.md",
    "docs/examples/action-output.md",
    "docs/examples/redteam-report.md",
    "docs/examples/agent-handoff.md",
    "packages/agent/src/profile.ts",
    "packages/harness/src/registry.ts",
    "packages/memory/src/local.ts"
  ];

  for (const file of files) {
    writeFile(repo, file, `export const fixture = ${JSON.stringify(file)};\n`);
  }

  return repo;
}

function createMediumRiskRepo(): string {
  const repo = createRepo({
    "src/api/users.ts": "export function handler() { return Response.json({ ok: true }); }\n"
  });

  writeFile(
    repo,
    "src/api/users.ts",
    [
      "export function handler(req: Request) {",
      "  if (req.method === \"POST\") return Response.json({ ok: true });",
      "  return Response.json({ ok: false });",
      "}",
      ""
    ].join("\n")
  );

  return repo;
}

function createHighRiskRepo(): string {
  const repo = createRepo({
    "src/api/users.ts": "export function handler() { return true; }\n",
    "src/auth/session.ts": "export function session() { return true; }\n",
    "src/db/schema.prisma": "model User { id String @id }\n"
  });

  writeFile(repo, "src/api/users.ts", "export function handler() { return false; }\n");
  writeFile(repo, "src/auth/session.ts", "export function session(token?: string) { if (!token) return null; return true; }\n");
  writeFile(repo, "src/db/schema.prisma", "model User { id String @id email String }\n");

  return repo;
}

function createRepo(files: Record<string, string>): string {
  const repo = createTempDir();
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "codedecay@example.com"]);
  git(repo, ["config", "user.name", "CodeDecay Test"]);

  for (const [path, contents] of Object.entries(files)) {
    writeFile(repo, path, contents);
  }

  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function createTempDir(): string {
  const root = execFileSync("mktemp", ["-d", join(tmpdir(), "codedecay-benchmark-XXXXXX")], {
    encoding: "utf8"
  }).trim();
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, path: string, contents: string): void {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents, "utf8");
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore"
  });
}
