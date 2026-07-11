const GITHUB_API = "https://api.github.com";
const DEFAULT_GITHUB_TIMEOUT_MS = 30 * 1000;

export function parseRepositoryRef(value) {
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
    return {
      owner: shorthandMatch[1],
      repo: stripGitSuffix(shorthandMatch[2]),
    };
  }

  throw new Error(
    `Invalid repo ref "${value}". Use a GitHub repo URL or owner/repo.`,
  );
}

export function parsePullRequestRef(value) {
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
    return {
      owner: shorthandMatch[1],
      repo: stripGitSuffix(shorthandMatch[2]),
      number: Number(shorthandMatch[3]),
    };
  }

  throw new Error(
    `Invalid PR ref "${value}". Use a GitHub pull URL or owner/repo#number.`,
  );
}

function parseGitHubUrl(value) {
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

function stripGitSuffix(value) {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

export async function fetchPullRequestContext(ref, token) {
  const pullRequest = await githubRequest(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
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

export async function fetchOpenPullRequestsForRepo(ref, token) {
  const repository = await githubRequest(`/repos/${ref.owner}/${ref.repo}`, {
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
  { owner, repo, headOwner, branch },
  token,
) {
  const head = encodeURIComponent(`${headOwner}:${branch}`);
  const pulls = await githubRequest(
    `/repos/${owner}/${repo}/pulls?state=open&head=${head}&per_page=10`,
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

async function fetchViewer(token) {
  if (!token) {
    return null;
  }

  try {
    const user = await githubRequest("/user", { token });
    return {
      login: user.login,
      htmlUrl: user.html_url,
    };
  } catch {
    return null;
  }
}

function normalizePullRequestSummary(pullRequest, viewer) {
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
  pullRequest,
  findings,
  token,
  body,
) {
  requireToken(token, "--post requires GITHUB_TOKEN");

  const comments = findings.map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: "RIGHT",
    body: formatInlineComment(finding),
  }));

  const review = await githubRequest(
    `/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}/reviews`,
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

export async function fetchReviewThreads(pullRequest, reviewId, token) {
  requireToken(token, "Fetching review threads requires a GitHub token");

  const nodes = [];
  let cursor = null;

  do {
    const data = await githubGraphql(
      REVIEW_THREADS_QUERY,
      {
        owner: pullRequest.owner,
        repo: pullRequest.repo,
        number: pullRequest.number,
        cursor,
      },
      token,
    );

    const connection = data?.repository?.pullRequest?.reviewThreads;
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

export function normalizeReviewThreads(nodes, reviewId) {
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

async function githubGraphql(query, variables, token) {
  const result = await githubRequest("/graphql", {
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

export async function postIssueComment(pullRequest, body, token) {
  requireToken(token, "--post requires GITHUB_TOKEN");

  await githubRequest(
    `/repos/${pullRequest.owner}/${pullRequest.repo}/issues/${pullRequest.number}/comments`,
    {
      token,
      method: "POST",
      body: { body },
    },
  );
}

async function fetchPullRequestFiles(ref, token) {
  const files = await githubPaginate(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`,
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

async function fetchOpenPullRequestPages(ref, token) {
  return githubPaginate(
    `/repos/${ref.owner}/${ref.repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    { token },
  );
}

export async function githubRequest(
  path,
  { token, method = "GET", body, timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS } = {},
) {
  const { data } = await githubRequestWithHeaders(path, {
    method,
    token,
    body,
    timeoutMs,
  });

  return data;
}

async function githubPaginate(path, options) {
  const results = [];
  let nextPath = path;

  while (nextPath) {
    const { data, headers } = await githubRequestWithHeaders(nextPath, options);
    results.push(...data);
    nextPath = parseNextLinkPath(headers.get("link"));
  }

  return results;
}

async function githubRequestWithHeaders(
  path,
  { token, method = "GET", body, timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS } = {},
) {
  const headers = {
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
      data: null,
      headers: response.headers,
    };
  }

  return {
    data: await response.json(),
    headers: response.headers,
  };
}

export function parseNextLinkPath(linkHeader) {
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

async function formatGitHubError(response, method, path) {
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

function buildChangedLineIndex(files) {
  const index = new Map();

  for (const file of files) {
    index.set(file.filename, parseChangedLines(file.patch));
  }

  return index;
}

export function parseChangedLines(patch) {
  const lines = new Set();
  let newLine = 0;

  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (line.startsWith(String.raw`\ No newline`)) {
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

function formatInlineComment(finding) {
  const suggestion = finding.suggestion
    ? `\n\nSuggested direction:\n\n${finding.suggestion}`
    : "";
  return `**${finding.severity}**: ${finding.comment}${suggestion}`;
}

function requireToken(token, message) {
  if (!token) {
    throw new Error(message);
  }
}
