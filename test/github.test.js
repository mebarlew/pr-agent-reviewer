import assert from "node:assert/strict";
import test from "node:test";
import {
  githubRequest,
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
  assert.deepEqual(parseRepositoryRef("https://github.com/acme/widgets.api.git"), {
    owner: "acme",
    repo: "widgets.api",
  });
});

test("parseRepositoryRef accepts shorthand repo refs", () => {
  assert.deepEqual(parseRepositoryRef("acme/widgets"), {
    owner: "acme",
    repo: "widgets",
  });
});

test("parsePullRequestRef accepts GitHub pull URLs", () => {
  assert.deepEqual(parsePullRequestRef("https://github.com/acme/widgets/pull/42"), {
    owner: "acme",
    repo: "widgets",
    number: 42,
  });
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

    assert.deepEqual(await githubRequest("/user", { timeoutMs: 1000 }), { ok: true });
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
