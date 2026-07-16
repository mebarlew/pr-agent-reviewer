const GITHUB_API = "https://api.github.com";
const DEFAULT_GITHUB_TIMEOUT_MS = 30 * 1000;

import type { Finding } from "./review/schema.ts";

export interface RepositoryRef {
  owner: string;
  repo: string;
}

export interface PullRequestRef extends RepositoryRef {
  number: number;
}

export interface PullRequestInfo extends PullRequestRef {
  title: string;
  htmlUrl: string;
  headSha: string;
  baseRef: string;
  headRef: string;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patchAvailable: boolean;
  patch: string;
}

export type ChangedLineIndex = Map<string, Set<number>>;

export interface PullRequestContext {
  pullRequest: PullRequestInfo;
  files: ChangedFile[];
  changedLines: ChangedLineIndex;
}

export interface GitHubViewer {
  login: string;
  htmlUrl: string;
}

export interface RepositoryInfo extends RepositoryRef {
  fullName: string;
  htmlUrl: string;
  private: boolean;
  defaultBranch: string;
}

export type ReviewState = "draft" | "needs_review" | "open";

export interface PullRequestSummary {
  number: number;
  title: string;
  htmlUrl: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  createdAt: string;
  baseRef: string;
  headRef: string;
  labels: string[];
  requestedReviewers: string[];
  requestedTeams: string[];
  requestedFromViewer: boolean;
  reviewState: ReviewState;
}

export interface BranchPullRequest {
  number: number;
  title: string;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
}

export interface ReviewThread {
  threadId: string;
  isResolved: boolean;
  resolvedBy: string | null;
  path: string;
  line: number | null;
}

// Raw GitHub REST API payloads, limited to the fields this app reads.
interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  updated_at: string;
  created_at: string;
  user: { login: string };
  head: { sha: string; ref: string };
  base: { ref: string };
  labels: { name: string }[];
  requested_reviewers: { login: string }[];
  requested_teams: { slug: string }[];
}

interface GitHubRepository {
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch: string;
}

interface GitHubUser {
  login: string;
  html_url: string;
}

interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

// Raw GraphQL reviewThreads nodes, limited to the queried fields.
export interface ReviewThreadNode {
  id: string;
  isResolved: boolean;
  resolvedBy: { login: string } | null;
  comments: {
    nodes: {
      path: string;
      line: number | null;
      originalLine: number | null;
      pullRequestReview: { databaseId: number } | null;
    }[];
  };
}

interface ReviewThreadsConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: ReviewThreadNode[];
}

interface ReviewThreadsQueryData {
  repository: {
    pullRequest: {
      reviewThreads: ReviewThreadsConnection | null;
    } | null;
  } | null;
}

export interface GithubRequestOptions {
  token?: string;
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

export function parseRepositoryRef(value: string): RepositoryRef {
  const url = parseGitHubUrl(value);
  if (url) {
    const [owner, repo] = url.pathname.split("/").filter(Boolean);

    if (owner && repo) {
      return {
        owner,
        repo: stripGitSuffix(repo),
      };
    }
  }

  const shorthandMatch = value.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shorthandMatch) {
    const owner = shorthandMatch[1];
    const repo = stripGitSuffix(shorthandMatch[2]);

    if (isSafeRepoSegment(owner) && isSafeRepoSegment(repo)) {
      return { owner, repo };
    }
  }

  throw new Error(
    `Invalid repo ref "${value}". Use a GitHub repo URL or owner/repo.`,
  );
}

export function parsePullRequestRef(value: string): PullRequestRef {
  const url = parseGitHubUrl(value);
  if (url) {
    const [owner, repo, segment, number] = url.pathname
      .split("/")
      .filter(Boolean);

    if (owner && repo && segment === "pull" && /^\d+$/.test(number)) {
      return {
        owner,
        repo: stripGitSuffix(repo),
        number: Number(number),
      };
    }
  }

  const shorthandMatch = value.trim().match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (shorthandMatch) {
    const owner = shorthandMatch[1];
    const repo = stripGitSuffix(shorthandMatch[2]);

    if (isSafeRepoSegment(owner) && isSafeRepoSegment(repo)) {
      return { owner, repo, number: Number(shorthandMatch[3]) };
    }
  }

  throw new Error(
    `Invalid PR ref "${value}". Use a GitHub pull URL or owner/repo#number.`,
  );
}

function parseGitHubUrl(value: string): URL | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("github.com/")
    ? `https://${trimmed}`
    : trimmed;

  try {
    const url = new URL(candidate);

    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname === "github.com"
    ) {
      return url;
    }
  } catch {
    return null;
  }

  return null;
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

// Owner and repo are interpolated into API paths, so anything that could
// change path resolution ("..", "/", "%2f", ...) must be rejected up front.
function isSafeRepoSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && !value.includes("..");
}

export async function fetchPullRequestContext(
  ref: PullRequestRef,
  token?: string,
): Promise<PullRequestContext> {
  const pullRequest = await githubRequest<GitHubPullRequest>(
    `${repoPath(ref)}/pulls/${ref.number}`,
    { token },
  );
  const files = await fetchPullRequestFiles(ref, token);

  return {
    pullRequest: {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      title: pullRequest.title,
      htmlUrl: pullRequest.html_url,
      headSha: pullRequest.head.sha,
      baseRef: pullRequest.base.ref,
      headRef: pullRequest.head.ref,
    },
    files,
    changedLines: buildChangedLineIndex(files),
  };
}

export async function fetchOpenPullRequestsForRepo(
  ref: RepositoryRef,
  token?: string,
): Promise<{
  repository: RepositoryInfo;
  viewer: GitHubViewer | null;
  pullRequests: PullRequestSummary[];
}> {
  const repository = await githubRequest<GitHubRepository>(repoPath(ref), {
    token,
  });
  const viewer = await fetchViewer(token);
  const pulls = await fetchOpenPullRequestPages(ref, token);

  return {
    repository: {
      owner: ref.owner,
      repo: ref.repo,
      fullName: repository.full_name,
      htmlUrl: repository.html_url,
      private: repository.private,
      defaultBranch: repository.default_branch,
    },
    viewer,
    pullRequests: pulls.map((pullRequest) =>
      normalizePullRequestSummary(pullRequest, viewer),
    ),
  };
}

export async function fetchPullRequestsForBranch(
  {
    owner,
    repo,
    headOwner,
    branch,
  }: { owner: string; repo: string; headOwner: string; branch: string },
  token?: string,
): Promise<BranchPullRequest[]> {
  const head = encodeURIComponent(`${headOwner}:${branch}`);
  const pulls = await githubRequest<GitHubPullRequest[]>(
    `${repoPath({ owner, repo })}/pulls?state=open&head=${head}&per_page=10`,
    { token },
  );

  return pulls.map((pullRequest) => ({
    number: pullRequest.number,
    title: pullRequest.title,
    htmlUrl: pullRequest.html_url,
    headRef: pullRequest.head.ref,
    baseRef: pullRequest.base.ref,
    draft: pullRequest.draft,
  }));
}

async function fetchViewer(token?: string): Promise<GitHubViewer | null> {
  if (!token) {
    return null;
  }

  try {
    const user = await githubRequest<GitHubUser>("/user", { token });
    return {
      login: user.login,
      htmlUrl: user.html_url,
    };
  } catch {
    return null;
  }
}

function normalizePullRequestSummary(
  pullRequest: GitHubPullRequest,
  viewer: GitHubViewer | null,
): PullRequestSummary {
  const requestedReviewers = pullRequest.requested_reviewers.map(
    (reviewer) => reviewer.login,
  );
  const requestedTeams = pullRequest.requested_teams.map((team) => team.slug);
  const requestedFromViewer = viewer
    ? requestedReviewers.includes(viewer.login)
    : false;
  const needsReview =
    !pullRequest.draft &&
    (requestedReviewers.length > 0 || requestedTeams.length > 0);

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    htmlUrl: pullRequest.html_url,
    author: pullRequest.user.login,
    draft: pullRequest.draft,
    updatedAt: pullRequest.updated_at,
    createdAt: pullRequest.created_at,
    baseRef: pullRequest.base.ref,
    headRef: pullRequest.head.ref,
    labels: pullRequest.labels.map((label) => label.name),
    requestedReviewers,
    requestedTeams,
    requestedFromViewer,
    reviewState: pullRequest.draft
      ? "draft"
      : needsReview
        ? "needs_review"
        : "open",
  };
}

export async function createPullRequestReview(
  pullRequest: PullRequestRef & { headSha: string },
  findings: Finding[],
  token: string | undefined,
  body: string,
): Promise<{ reviewId: number }> {
  requireToken(token, "--post requires GITHUB_TOKEN");

  const comments = findings.map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: "RIGHT",
    body: formatInlineComment(finding),
  }));

  const review = await githubRequest<{ id: number }>(
    `${repoPath(pullRequest)}/pulls/${pullRequest.number}/reviews`,
    {
      token,
      method: "POST",
      body: {
        commit_id: pullRequest.headSha,
        event: "COMMENT",
        body,
        comments,
      },
    },
  );

  return { reviewId: review.id };
}

const REVIEW_THREADS_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            resolvedBy {
              login
            }
            comments(first: 1) {
              nodes {
                path
                line
                originalLine
                pullRequestReview {
                  databaseId
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchReviewThreads(
  pullRequest: PullRequestRef,
  reviewId: number,
  token?: string,
): Promise<ReviewThread[]> {
  requireToken(token, "Fetching review threads requires a GitHub token");

  const nodes: ReviewThreadNode[] = [];
  let cursor: string | null = null;

  do {
    const data: ReviewThreadsQueryData | null =
      await githubGraphql<ReviewThreadsQueryData>(
        REVIEW_THREADS_QUERY,
        {
          owner: pullRequest.owner,
          repo: pullRequest.repo,
          number: pullRequest.number,
          cursor,
        },
        token,
      );

    const connection: ReviewThreadsConnection | null | undefined =
      data?.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      break;
    }

    nodes.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (cursor);

  return normalizeReviewThreads(nodes, reviewId);
}

export function normalizeReviewThreads(
  nodes: ReviewThreadNode[],
  reviewId: number,
): ReviewThread[] {
  return nodes
    .filter(
      (thread) =>
        thread.comments.nodes[0]?.pullRequestReview?.databaseId === reviewId,
    )
    .map((thread) => {
      const comment = thread.comments.nodes[0];

      return {
        threadId: thread.id,
        isResolved: thread.isResolved,
        resolvedBy: thread.resolvedBy?.login ?? null,
        path: comment.path,
        // originalLine is the position at comment creation, matching the line
        // the review was posted against; `line` shifts as new commits land.
        line: comment.originalLine ?? comment.line,
      };
    });
}

interface GraphqlResponse<T> {
  data?: T | null;
  errors?: { message: string }[];
}

async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T | null> {
  const result = await githubRequest<GraphqlResponse<T>>("/graphql", {
    token,
    method: "POST",
    body: { query, variables },
  });

  if (result?.errors?.length) {
    throw new Error(
      `GitHub GraphQL request failed: ${result.errors[0].message}`,
    );
  }

  return result?.data ?? null;
}

export async function postIssueComment(
  pullRequest: PullRequestRef,
  body: string,
  token?: string,
): Promise<void> {
  requireToken(token, "--post requires GITHUB_TOKEN");

  await githubRequest(
    `${repoPath(pullRequest)}/issues/${pullRequest.number}/comments`,
    {
      token,
      method: "POST",
      body: { body },
    },
  );
}

async function fetchPullRequestFiles(
  ref: PullRequestRef,
  token?: string,
): Promise<ChangedFile[]> {
  const files = await githubPaginate<GitHubPullRequestFile>(
    `${repoPath(ref)}/pulls/${ref.number}/files?per_page=100`,
    { token },
  );

  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patchAvailable: typeof file.patch === "string",
    patch: file.patch ?? "",
  }));
}

async function fetchOpenPullRequestPages(
  ref: RepositoryRef,
  token?: string,
): Promise<GitHubPullRequest[]> {
  return githubPaginate<GitHubPullRequest>(
    `${repoPath(ref)}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    { token },
  );
}

function repoPath({ owner, repo }: RepositoryRef): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export async function githubRequest<T = unknown>(
  path: string,
  {
    token,
    method = "GET",
    body,
    timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS,
  }: GithubRequestOptions = {},
): Promise<T> {
  const { data } = await githubRequestWithHeaders<T>(path, {
    method,
    token,
    body,
    timeoutMs,
  });

  return data;
}

async function githubPaginate<T>(
  path: string,
  options: GithubRequestOptions,
): Promise<T[]> {
  const results: T[] = [];
  let nextPath: string | null = path;

  while (nextPath) {
    const { data, headers } = await githubRequestWithHeaders<T[]>(
      nextPath,
      options,
    );
    results.push(...data);
    nextPath = parseNextLinkPath(headers.get("link"));
  }

  return results;
}

async function githubRequestWithHeaders<T>(
  path: string,
  {
    token,
    method = "GET",
    body,
    timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS,
  }: GithubRequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-agent-reviewer",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(await formatGitHubError(response, method, path));
  }

  if (response.status === 204) {
    return {
      // 204 responses have no body; T is null for the endpoints that hit
      // this branch, mirroring the untyped behavior.
      data: null as T,
      headers: response.headers,
    };
  }

  return {
    data: (await response.json()) as T,
    headers: response.headers,
  };
}

export function parseNextLinkPath(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const link of linkHeader.split(",")) {
    const match = link.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (!match || match[2] !== "next") {
      continue;
    }

    const url = new URL(match[1]);
    return `${url.pathname}${url.search}`;
  }

  return null;
}

async function formatGitHubError(
  response: Response,
  method: string,
  path: string,
): Promise<string> {
  const text = await response.text();
  const retryAfter = response.headers.get("retry-after");
  const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
  const rateLimitReset = response.headers.get("x-ratelimit-reset");
  const details = [
    `GitHub ${method} ${path} failed: ${response.status} ${text}`,
  ];

  if (retryAfter) {
    details.push(`Retry after ${retryAfter} seconds.`);
  } else if (rateLimitRemaining === "0" && rateLimitReset) {
    details.push(
      `Rate limit resets at ${new Date(Number(rateLimitReset) * 1000).toISOString()}.`,
    );
  }

  return details.join(" ");
}

function buildChangedLineIndex(files: ChangedFile[]): ChangedLineIndex {
  const index: ChangedLineIndex = new Map();

  for (const file of files) {
    index.set(file.filename, parseChangedLines(file.patch));
  }

  return index;
}

export function parseChangedLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let newLine = 0;

  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (line.startsWith("\\ No newline")) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.add(newLine);
      newLine += 1;
      continue;
    }

    if (!line.startsWith("-")) {
      newLine += 1;
    }
  }

  return lines;
}

function formatInlineComment(finding: Finding): string {
  const suggestion = finding.suggestion
    ? `\n\nSuggested direction:\n\n${finding.suggestion}`
    : "";
  return `**${finding.severity}**: ${finding.comment}${suggestion}`;
}

function requireToken(
  token: string | undefined,
  message: string,
): asserts token is string {
  if (!token) {
    throw new Error(message);
  }
}
