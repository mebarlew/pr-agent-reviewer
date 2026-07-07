import { normalizeFinding, stringValue } from "./schema.js";

export function parseAgentReview(text) {
  const parsed = JSON.parse(extractJson(text));
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = [];
  const validationErrors = [];

  rawFindings.forEach((finding, index) => {
    const normalized = normalizeFinding(finding);

    if (normalized) {
      findings.push(normalized);
      return;
    }

    validationErrors.push(`findings[${index}] does not match the expected schema.`);
  });

  if (rawFindings.length > 0 && findings.length === 0) {
    throw new Error("Agent returned findings, but none matched the expected schema.");
  }

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    findings,
    validationErrors,
  };
}

export function splitInlineFindings(findings, changedLines) {
  const inline = [];
  const skipped = [];

  for (const finding of findings) {
    const fileLines = changedLines.get(finding.path);

    if (fileLines?.has(finding.line)) {
      inline.push(finding);
    } else {
      skipped.push({
        ...finding,
        skipReason: "line is not part of the changed diff",
      });
    }
  }

  return { inline, skipped };
}

export function buildReviewMarkdown({ providerName, pullRequest, review, inlineFindings, skippedFindings }) {
  const lines = [
    `## AI PR review (${providerName})`,
    "",
    review.summary || `Reviewed ${pullRequest.htmlUrl}.`,
    "",
    `Inline findings: ${inlineFindings.length}`,
    `Needs manual placement: ${skippedFindings.length}`,
  ];

  if (skippedFindings.length > 0) {
    lines.push("", "### Findings not posted inline", "");

    for (const finding of skippedFindings) {
      lines.push(`- **${finding.severity}** ${finding.path}:${finding.line} - ${finding.comment}`);
      if (finding.suggestion) {
        lines.push(`  Suggested direction: ${finding.suggestion}`);
      }
    }
  }

  if (review.validationErrors?.length > 0) {
    lines.push("", `Invalid findings ignored: ${review.validationErrors.length}`);
  }

  if (inlineFindings.length > 0) {
    lines.push("", "### Inline findings", "");

    for (const finding of inlineFindings) {
      lines.push(`- **${finding.severity}** ${finding.path}:${finding.line} - ${finding.comment}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function extractJson(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    return fenced[1];
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("Agent did not return JSON.");
}
