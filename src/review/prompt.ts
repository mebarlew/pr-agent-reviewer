import type { ChangedFile } from "../github.ts";

export interface ReviewPromptContext {
  pullRequest: { title: string; baseRef: string; headRef: string };
  files: ChangedFile[];
}

export function buildReviewPrompt(context: ReviewPromptContext): string {
  const files = context.files.map(formatFile).join("\n\n");

  return `You are reviewing a GitHub pull request. Find real bugs, security issues, broken edge cases, missing tests for changed behavior, and maintainability problems that would matter before merge.

Do not comment on style, formatting, naming, or personal preference unless it causes a concrete bug.
Only report issues that are visible in the diff below.
Every finding must point to a changed line in the new version of a file.

Return only valid JSON. Do not wrap it in markdown.

Schema:
{
  "summary": "short summary string",
  "findings": [
    {
      "path": "relative/file/path",
      "line": 123,
      "severity": "bug|security|performance|maintainability|test|question",
      "comment": "specific review comment",
      "suggestion": "optional suggested direction"
    }
  ]
}

Pull request:
Title: ${context.pullRequest.title}
Base: ${context.pullRequest.baseRef}
Head: ${context.pullRequest.headRef}

Diff:
${files}
`;
}

function formatFile(file: ChangedFile): string {
  const diff =
    file.patchAvailable === false
      ? "Patch unavailable from GitHub for this file, usually because it is binary or too large. Do not create line comments for this file unless another diff shows the changed line."
      : `\`\`\`diff
${file.patch}
\`\`\``;

  return `File: ${file.filename}
Status: ${file.status}
Additions: ${file.additions}
Deletions: ${file.deletions}

${diff}`;
}
