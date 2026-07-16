import { loadConfig } from "../config.ts";
import {
  createPullRequestReview,
  fetchPullRequestContext,
  postIssueComment,
} from "../github.ts";
import type {
  ChangedFile,
  PullRequestInfo,
  PullRequestRef,
} from "../github.ts";
import { runProvider } from "../providers/index.ts";
import {
  buildReviewMarkdown,
  parseAgentReview,
  splitInlineFindings,
} from "./findings.ts";
import type { AgentReview, SkippedFinding } from "./findings.ts";
import type { Finding } from "./schema.ts";
import { buildReviewPrompt } from "./prompt.ts";

export interface RunReviewOptions {
  pullRequest: PullRequestRef;
  providerName: string;
  workspace: string;
  configPath?: string;
  githubToken?: string;
}

export interface ReviewRunResult {
  providerName: string;
  pullRequest: PullRequestInfo;
  files: ChangedFile[];
  review: AgentReview;
  inlineFindings: Finding[];
  skippedFindings: SkippedFinding[];
  markdown: string;
  agent: {
    stopReason?: string;
    stderr?: string;
  };
}

export interface PostReviewOptions {
  pullRequest: PullRequestInfo;
  providerName: string;
  review: { summary?: string; validationErrors?: string[] };
  inlineFindings: Finding[];
  skippedFindings: Finding[];
  githubToken?: string;
}

export interface PostReviewResult {
  githubReviewId: number | null;
  inlineComments: number;
  summaryComments: number;
}

export async function runReview({
  pullRequest,
  providerName,
  workspace,
  configPath,
  githubToken,
}: RunReviewOptions): Promise<ReviewRunResult> {
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
}: PostReviewOptions): Promise<PostReviewResult> {
  const markdown = buildReviewMarkdown({
    providerName,
    pullRequest,
    review,
    inlineFindings,
    skippedFindings,
  });

  let githubReviewId: number | null = null;

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
