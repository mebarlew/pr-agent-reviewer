import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewMarkdown,
  parseAgentReview,
  splitInlineFindings,
} from "../src/review/findings.js";

test("parseAgentReview extracts fenced JSON and normalizes findings", () => {
  const review = parseAgentReview(`Here you go:
\`\`\`json
{
  "summary": "One issue.",
  "findings": [
    {
      "path": "src/app.js",
      "line": 12,
      "severity": "BUG",
      "comment": "This can throw.",
      "suggestion": "Guard the null value."
    },
    {
      "path": "src/app.js",
      "line": "nope",
      "severity": "style",
      "comment": "Bad style."
    }
  ]
}
\`\`\``);

  assert.deepEqual(review, {
    summary: "One issue.",
    findings: [
      {
        path: "src/app.js",
        line: 12,
        severity: "bug",
        comment: "This can throw.",
        suggestion: "Guard the null value.",
      },
    ],
    validationErrors: ["findings[1] does not match the expected schema."],
  });
});

test("parseAgentReview rejects output when every finding is invalid", () => {
  assert.throws(
    () =>
      parseAgentReview(`{
        "summary": "Bad shape.",
        "findings": [
          {
            "path": "src/app.js",
            "line": "nope",
            "severity": "style",
            "comment": "Bad style."
          }
        ]
      }`),
    /none matched the expected schema/,
  );
});

test("splitInlineFindings keeps only changed lines inline", () => {
  const changedLines = new Map([["src/app.js", new Set([12])]]);
  const findings = [
    { path: "src/app.js", line: 12, severity: "bug", comment: "Inline" },
    { path: "src/app.js", line: 20, severity: "test", comment: "Skipped" },
  ];

  assert.deepEqual(splitInlineFindings(findings, changedLines), {
    inline: [findings[0]],
    skipped: [
      {
        ...findings[1],
        skipReason: "line is not part of the changed diff",
      },
    ],
  });
});

test("buildReviewMarkdown includes inline and skipped findings", () => {
  const markdown = buildReviewMarkdown({
    providerName: "codex",
    pullRequest: { htmlUrl: "https://github.com/acme/widgets/pull/42" },
    review: { summary: "Looks risky." },
    inlineFindings: [
      { path: "src/app.js", line: 12, severity: "bug", comment: "Inline" },
    ],
    skippedFindings: [
      { path: "src/app.js", line: 20, severity: "test", comment: "Skipped" },
    ],
  });

  assert.match(markdown, /AI PR review \(codex\)/);
  assert.match(markdown, /Inline findings: 1/);
  assert.match(markdown, /Needs manual placement: 1/);
});
