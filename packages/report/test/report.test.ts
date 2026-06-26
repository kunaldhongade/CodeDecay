import { describe, expect, it } from "vitest";
import type { CodeDecayReport } from "@submuxhq/codedecay-core";
import { renderJsonReport, renderMarkdownReport, renderSarifReport } from "../src/index";

const report: CodeDecayReport = {
  tool: "CodeDecay",
  version: "0.1.2",
  generatedAt: "2026-06-22T00:00:00.000Z",
  base: "main",
  head: "HEAD",
  summary: {
    mergeRiskScore: 72,
    decayScore: 44,
    riskLevel: "high",
    findingCounts: {
      low: 0,
      medium: 1,
      high: 1
    },
    mergeRiskBreakdown: {
      score: 72,
      rawScore: 78,
      adjustedScore: 72,
      highestSeverity: "high",
      heuristicOnly: false,
      contributors: [
        {
          id: "risky-auth-change:src/auth/session.ts:3",
          label: "Auth changed",
          points: 30,
          evidence: "direct",
          reason: "Auth behavior changed.",
          category: "regression",
          severity: "high",
          ruleId: "risky-auth-change",
          file: "src/auth/session.ts",
          line: 3
        }
      ],
      dampeners: [],
      notes: []
    },
    decayBreakdown: {
      score: 44,
      rawScore: 44,
      adjustedScore: 44,
      highestSeverity: "medium",
      heuristicOnly: false,
      contributors: [
        {
          id: "high-complexity:src/auth/session.ts:3",
          label: "High complexity",
          points: 16,
          evidence: "heuristic",
          reason: "Complexity increased.",
          category: "decay",
          severity: "medium",
          ruleId: "high-complexity",
          file: "src/auth/session.ts",
          line: 3
        }
      ],
      dampeners: [],
      notes: []
    }
  },
  changedFiles: [
    {
      path: "src/auth/session.ts",
      status: "modified",
      additions: 4,
      deletions: 1,
      addedLines: [{ line: 3, content: "return null;" }]
    }
  ],
  impactedAreas: [
    {
      name: "Authentication and authorization",
      kind: "auth",
      risk: "high",
      files: ["src/auth/session.ts"]
    }
  ],
  impactedRoutes: [
    {
      framework: "nextjs",
      kind: "api-route",
      route: "/api/session",
      methods: ["GET"],
      files: ["src/app/api/session/route.ts"],
      risk: "high",
      reasons: ["Next.js App Router API route changed"],
      recommendedTests: ["Add or run tests covering src/app/api/session/route.ts"]
    },
    {
      framework: "nextjs",
      kind: "ui-route",
      route: "/dashboard",
      methods: [],
      files: ["src/app/dashboard/page.tsx"],
      risk: "medium",
      reasons: ["Next.js App Router UI route changed"],
      recommendedTests: ["Add or run tests covering src/app/dashboard/page.tsx"]
    }
  ],
  findings: [
    {
      ruleId: "risky-auth-change",
      title: "Auth changed",
      description: "Auth behavior changed.",
      severity: "high",
      category: "regression",
      file: "src/auth/session.ts",
      line: 3
    }
  ],
  recommendedTests: ["src/auth/session.test.ts", "Add or run tests covering next.config.js"],
  testEvidence: {
    mode: "runtime_augmented",
    sources: [{ kind: "istanbul", path: "coverage/coverage-final.json" }],
    changedSources: [
      {
        path: "src/auth/session.ts",
        status: "partial",
        measuredLines: [3, 4],
        coveredLines: [3],
        uncoveredLines: [4],
        sourceKinds: ["istanbul"],
        sourcePaths: ["coverage/coverage-final.json"]
      }
    ],
    notes: ["Runtime coverage artifacts were found, but some changed paths were not measured: src/app/dashboard/page.tsx."]
  }
};

describe("reports", () => {
  it("renders markdown", () => {
    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("CodeDecay Report");
    expect(markdown).toContain("Merge risk");
    expect(markdown).toContain("src/auth/session.ts");
    expect(markdown).toContain("### Likely Impacted Routes And APIs");
    expect(markdown).toContain("### Merge Risk Breakdown");
    expect(markdown).toContain("### Test Evidence");
    expect(markdown).toContain("High `GET /api/session` (Next.js API route)");
    expect(markdown).toContain("Medium `/dashboard` (Next.js UI route)");
    expect(markdown).toContain("- `src/auth/session.test.ts`");
    expect(markdown).toContain("- `Add or run tests covering next.config.js`");
    expect(markdown).not.toContain("- Add or run tests covering next.config.js");
  });

  it("renders json", () => {
    const json = JSON.parse(renderJsonReport(report));

    expect(json).toMatchObject({
      tool: "CodeDecay",
      summary: {
        riskLevel: "high"
      }
    });
    expect(json.impactedRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "/api/session",
          methods: ["GET"]
        })
      ])
    );
  });

  it("renders minimal sarif", () => {
    const sarif = JSON.parse(renderSarifReport(report));

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].tool.driver.informationUri).toBe("https://github.com/SubmuxHQ/CodeDecay");
    expect(sarif.runs[0].results[0].ruleId).toBe("risky-auth-change");
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(3);
    expect(sarif.runs[0].properties.mergeRiskBreakdown.score).toBe(72);
  });
});
