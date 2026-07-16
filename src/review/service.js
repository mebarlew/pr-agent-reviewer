import { loadConfig } from "../config.js";
import {
  createPullRequestReview,
  fetchPullRequestContext,
  postIssueComment,
} from "../github.js";
import { runProvider } from "../providers/index.js";
import {
  buildReviewMarkdown,
  parseAgentReview,
  splitInlineFindings,
} from "./findings.js";
import { buildReviewPrompt } from "./prompt.js";

export async function runReview({
  pullRequest,
  providerName,
  workspace,
  configPath,
  githubToken,
}) {
  const config = await loadConfig(configPath, workspace);
  const provider = config.providers[providerName];

  if (!provider) {
    const known = Object.keys(config.providers).sort().join(", ") || "none";
    throw new Error(
      `Unknown provider "${providerName}". Configured providers: ${known}`,
    );
  }

  const context = await fetchPullRequestContext(pullRequest, githubToken);
  const prompt = buildReviewPrompt(context);
  const agentResult = await runProvider(provider, { prompt, workspace });
  const review = parseAgentReview(agentResult.text);
  const split = splitInlineFindings(review.findings, context.changedLines);
  const markdown = buildReviewMarkdown({
    providerName,
    pullRequest: context.pullRequest,
    review,
    inlineFindings: split.inline,
    skippedFindings: split.skipped,
  });

  return {
    providerName,
    pullRequest: context.pullRequest,
    files: context.files,
    review,
    inlineFindings: split.inline,
    skippedFindings: split.skipped,
    markdown,
    agent: {
      stopReason: agentResult.stopReason,
      stderr: agentResult.stderr,
    },
  };
}

export async function postReview({
  pullRequest,
  providerName,
  review,
  inlineFindings,
  skippedFindings,
  githubToken,
}) {
  const markdown = buildReviewMarkdown({
    providerName,
    pullRequest,
    review,
    inlineFindings,
    skippedFindings,
  });

  let githubReviewId = null;

  if (inlineFindings.length > 0) {
    const created = await createPullRequestReview(
      pullRequest,
      inlineFindings,
      githubToken,
      markdown,
    );
    githubReviewId = created.reviewId;
  } else if (skippedFindings.length > 0 || Boolean(review.summary)) {
    await postIssueComment(pullRequest, markdown, githubToken);
  }

  return {
    githubReviewId,
    inlineComments: inlineFindings.length,
    summaryComments:
      inlineFindings.length > 0 ||
      skippedFindings.length > 0 ||
      Boolean(review.summary)
        ? 1
        : 0,
  };
}
