import type { EditableFinding, PullRequestLink } from "./types";

export function buildFixPrompt(
  pullRequest: PullRequestLink | null,
  summary: string,
  findings: EditableFinding[],
): string {
  if (!pullRequest) {
    return "Run a review to generate a fix prompt.";
  }

  const lines = [
    `Fix the findings from this PR review: ${pullRequest.htmlUrl}`,
    "",
    summary.trim(),
    "",
  ];

  findings.forEach((finding, index) => {
    lines.push(
      `${index + 1}. ${finding.path}:${finding.line} [${finding.severity}]`,
    );
    lines.push(finding.comment.trim());
    const suggestion = finding.suggestion.trim();
    if (suggestion) {
      lines.push(`Suggested direction: ${suggestion}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}
