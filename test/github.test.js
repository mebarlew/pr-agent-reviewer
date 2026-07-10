import assert from "node:assert/strict";
import test from "node:test";
import {
  createPullRequestReview,
  fetchReviewThreads,
  githubRequest,
  normalizeReviewThreads,
  parseNextLinkPath,
  parseChangedLines,
  parsePullRequestRef,
  parseRepositoryRef,
} from "../src/github.js";

test("parseRepositoryRef accepts GitHub repo URLs", () => {
  assert.deepEqual(parseRepositoryRef("https://github.com/acme/widgets"), {
    owner: "acme",
    repo: "widgets",
  });
});

test("parseRepositoryRef accepts dotted repo names", () => {
  assert.deepEqual(
    parseRepositoryRef("https://github.com/acme/widgets.api.git"),
    {
      owner: "acme",
      repo: "widgets.api",
    },
  );
});

test("parseRepositoryRef accepts shorthand repo refs", () => {
  assert.deepEqual(parseRepositoryRef("acme/widgets"), {
    owner: "acme",
    repo: "widgets",
  });
});

test("parsePullRequestRef accepts GitHub pull URLs", () => {
  assert.deepEqual(
    parsePullRequestRef("https://github.com/acme/widgets/pull/42"),
    {
      owner: "acme",
      repo: "widgets",
      number: 42,
    },
  );
});

test("parsePullRequestRef accepts protocol-less GitHub pull URLs", () => {
  assert.deepEqual(parsePullRequestRef("github.com/acme/widgets.api/pull/42"), {
    owner: "acme",
    repo: "widgets.api",
    number: 42,
  });
});

test("parsePullRequestRef accepts shorthand refs", () => {
  assert.deepEqual(parsePullRequestRef("acme/widgets#42"), {
    owner: "acme",
    repo: "widgets",
    number: 42,
  });
});

test("parseChangedLines indexes added lines in each hunk", () => {
  const changed = parseChangedLines(`@@ -1,4 +1,5 @@
 context
-old
+new
 same
@@ -20,2 +21,3 @@
+added
 tail
\\ No newline at end of file`);

  assert.deepEqual([...changed], [2, 21]);
});

test("githubRequest sends an abort signal for request timeouts", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.signal);
      assert.equal(options.signal.aborted, false);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    assert.deepEqual(await githubRequest("/user", { timeoutMs: 1000 }), {
      ok: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseNextLinkPath reads GitHub Link header pagination", () => {
  assert.equal(
    parseNextLinkPath(
      '<https://api.github.com/repos/acme/widgets/pulls?per_page=100&page=2>; rel="next", <https://api.github.com/repos/acme/widgets/pulls?per_page=100&page=5>; rel="last"',
    ),
    "/repos/acme/widgets/pulls?per_page=100&page=2",
  );
});

test("createPullRequestReview returns the created review id", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url, options) => {
      assert.ok(String(url).endsWith("/repos/acme/widgets/pulls/42/reviews"));
      assert.equal(options.method, "POST");

      return new Response(JSON.stringify({ id: 987654 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const result = await createPullRequestReview(
      { owner: "acme", repo: "widgets", number: 42, headSha: "abc123" },
      [{ path: "src/a.js", line: 3, severity: "bug", comment: "boom" }],
      "test-token",
      "Summary",
    );

    assert.deepEqual(result, { reviewId: 987654 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizeReviewThreads keeps only threads from the given review", () => {
  const threads = normalizeReviewThreads(
    [
      {
        id: "T_1",
        isResolved: true,
        resolvedBy: { login: "octocat" },
        comments: {
          nodes: [
            {
              path: "src/a.js",
              line: 12,
              originalLine: 10,
              pullRequestReview: { databaseId: 111 },
            },
          ],
        },
      },
      {
        id: "T_2",
        isResolved: false,
        resolvedBy: null,
        comments: {
          nodes: [
            {
              path: "src/b.js",
              line: null,
              originalLine: 7,
              pullRequestReview: { databaseId: 111 },
            },
          ],
        },
      },
      {
        id: "T_other",
        isResolved: true,
        resolvedBy: { login: "someone" },
        comments: {
          nodes: [
            {
              path: "src/c.js",
              line: 1,
              originalLine: 1,
              pullRequestReview: { databaseId: 222 },
            },
          ],
        },
      },
    ],
    111,
  );

  assert.deepEqual(threads, [
    {
      threadId: "T_1",
      isResolved: true,
      resolvedBy: "octocat",
      path: "src/a.js",
      line: 12,
    },
    {
      threadId: "T_2",
      isResolved: false,
      resolvedBy: null,
      path: "src/b.js",
      line: 7,
    },
  ]);
});

test("fetchReviewThreads pages through the GraphQL connection", async () => {
  const originalFetch = globalThis.fetch;
  const pages = [
    {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: true, endCursor: "CURSOR_1" },
              nodes: [
                {
                  id: "T_1",
                  isResolved: true,
                  resolvedBy: { login: "octocat" },
                  comments: {
                    nodes: [
                      {
                        path: "src/a.js",
                        line: 12,
                        originalLine: 10,
                        pullRequestReview: { databaseId: 111 },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: "T_2",
                  isResolved: false,
                  resolvedBy: null,
                  comments: {
                    nodes: [
                      {
                        path: "src/b.js",
                        line: 3,
                        originalLine: 3,
                        pullRequestReview: { databaseId: 111 },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  ];
  const cursors = [];

  try {
    globalThis.fetch = async (url, options) => {
      assert.ok(String(url).endsWith("/graphql"));
      cursors.push(JSON.parse(options.body).variables.cursor);

      return new Response(JSON.stringify(pages.shift()), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const threads = await fetchReviewThreads(
      { owner: "acme", repo: "widgets", number: 42 },
      111,
      "test-token",
    );

    assert.deepEqual(cursors, [null, "CURSOR_1"]);
    assert.deepEqual(
      threads.map((thread) => thread.threadId),
      ["T_1", "T_2"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("githubRequest includes retry guidance for rate limits", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      new Response("secondary rate limit", {
        status: 403,
        headers: {
          "Retry-After": "60",
        },
      });

    await assert.rejects(
      () => githubRequest("/user", { timeoutMs: 1000 }),
      /Retry after 60 seconds/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
