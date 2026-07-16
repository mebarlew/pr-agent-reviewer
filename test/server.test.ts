import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../src/server.js";
import type {
  CreateAppServerOptions,
  GithubTokenStore,
} from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("api requests require the local auth token", async () => {
  await withServer({ authToken: "secret" }, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/config`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/config`, {
      headers: {
        "X-PR-Agent-Token": "secret",
      },
    });
    assert.equal(authorized.status, 200);

    const payload = (await authorized.json()) as { providers: unknown };
    assert.ok(Array.isArray(payload.providers));
    assert.match(
      authorized.headers.get("content-security-policy") ?? "",
      /default-src 'self'/,
    );
  });
});

test("api requests reject non-loopback origins", async () => {
  await withServer({ authToken: "secret" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`, {
      headers: {
        Origin: "https://example.com",
        "X-PR-Agent-Token": "secret",
      },
    });

    assert.equal(response.status, 403);
  });
});

test("api requests enforce the body size cap", async () => {
  await withServer(
    { authToken: "secret", maxBodyBytes: 32 },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/git`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PR-Agent-Token": "secret",
        },
        body: JSON.stringify({ workspace: "x".repeat(64) }),
      });

      assert.equal(response.status, 413);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /Request body too large/,
      );
    },
  );
});

test("api requests tear down the socket after exceeding the body cap", async () => {
  await withServer(
    { authToken: "secret", maxBodyBytes: 32 },
    async (baseUrl) => {
      const port = Number(new URL(baseUrl).port);
      const socket = createConnection({ host: "127.0.0.1", port });
      await once(socket, "connect");

      const body = JSON.stringify({ workspace: "x".repeat(64) });
      socket.write(
        [
          "POST /api/git HTTP/1.1",
          "Host: 127.0.0.1",
          "Content-Type: application/json",
          "X-PR-Agent-Token: secret",
          `Content-Length: ${body.length + 1024}`,
          "",
          body,
        ].join("\r\n"),
      );

      let received = "";
      socket.on("data", (chunk) => {
        received += chunk;
      });

      // Without request.destroy() the server keeps the socket open waiting
      // for the remaining declared body until the keep-alive timeout (5s).
      const startedAt = Date.now();
      await once(socket, "close");
      assert.match(received, /413/);
      assert.ok(Date.now() - startedAt < 2000, "socket was not torn down");
    },
  );
});

test("api post requests require JSON content type", async () => {
  await withServer({ authToken: "secret" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/git`, {
      method: "POST",
      headers: {
        "X-PR-Agent-Token": "secret",
      },
      body: "{}",
    });

    assert.equal(response.status, 415);
  });
});

test("api post requests reject malformed JSON as a client error", async () => {
  await withServer({ authToken: "secret" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/git`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PR-Agent-Token": "secret",
      },
      body: "{nope",
    });

    assert.equal(response.status, 400);
    assert.match(
      ((await response.json()) as { error: string }).error,
      /Invalid JSON body/,
    );
  });
});

test("github token endpoints save and clear desktop tokens", async () => {
  const githubTokenStore = createFakeGithubTokenStore();

  await withServer(
    { authToken: "secret", githubTokenStore },
    async (baseUrl) => {
      const saved = await fetch(`${baseUrl}/api/github-token`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-PR-Agent-Token": "secret",
        },
        body: JSON.stringify({ githubToken: "ghp_secret" }),
      });
      assert.equal(saved.status, 200);
      assert.equal(
        ((await saved.json()) as { hasStoredGithubToken: boolean })
          .hasStoredGithubToken,
        true,
      );
      assert.equal(await githubTokenStore.getToken(), "ghp_secret");

      const cleared = await fetch(`${baseUrl}/api/github-token`, {
        method: "DELETE",
        headers: {
          "X-PR-Agent-Token": "secret",
        },
      });
      assert.equal(cleared.status, 200);
      assert.equal(
        ((await cleared.json()) as { hasStoredGithubToken: boolean })
          .hasStoredGithubToken,
        false,
      );
    },
  );
});

test("github token save is desktop-only without a token store", async () => {
  await withServer({ authToken: "secret" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/github-token`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-PR-Agent-Token": "secret",
      },
      body: JSON.stringify({ githubToken: "ghp_secret" }),
    });

    assert.equal(response.status, 501);
  });
});

test("github token status only treats usable stored tokens as available", async () => {
  const githubTokenStore = {
    status: async () => ({
      hasStoredGithubToken: true,
      reason: "Secure token storage is not available on this system.",
      secureStorageAvailable: false,
      storageBackend: "unknown",
    }),
  } as GithubTokenStore;

  await withServer(
    { authToken: "secret", githubTokenStore },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/config`, {
        headers: {
          "X-PR-Agent-Token": "secret",
        },
      });

      assert.equal(response.status, 200);

      const payload = (await response.json()) as {
        githubToken: { hasStoredGithubToken: boolean; hasGithubToken: boolean };
      };
      assert.equal(payload.githubToken.hasStoredGithubToken, true);
      assert.equal(payload.githubToken.hasGithubToken, false);
    },
  );
});

test("review threads endpoint validates its input", async () => {
  await withServer({ authToken: "secret" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/review-threads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PR-Agent-Token": "secret",
      },
      body: JSON.stringify({
        prRef: "https://github.com/acme/widgets/pull/42",
        reviewId: "not-a-number",
      }),
    });

    assert.equal(response.status, 400);
    assert.match(
      ((await response.json()) as { error: string }).error,
      /reviewId must be an integer/,
    );
  });
});

test("review runs resolve providers from the workspace and posts reject invalid findings", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pr-agent-reviewer-"));
  const originalFetch = globalThis.fetch;

  try {
    await writeFile(
      join(workspace, ".pr-agent-reviewer.json"),
      JSON.stringify({
        providers: {
          fake: {
            type: "acp",
            command: process.execPath,
            args: [join(__dirname, "../fixtures/fake-acp-agent.ts")],
          },
        },
      }),
    );

    globalThis.fetch = async (url, options) => {
      const target = String(url);

      if (target === "https://api.github.com/repos/acme/widgets/pulls/42") {
        return jsonResponse({
          title: "Widget PR",
          html_url: "https://github.com/acme/widgets/pull/42",
          head: { sha: "abc123", ref: "feature" },
          base: { ref: "main" },
        });
      }

      if (
        target.startsWith(
          "https://api.github.com/repos/acme/widgets/pulls/42/files",
        )
      ) {
        return jsonResponse([
          {
            filename: "src/app.js",
            status: "modified",
            additions: 1,
            deletions: 0,
            changes: 1,
            patch: "@@ -1,1 +1,2 @@\n context\n+new line",
          },
        ]);
      }

      return originalFetch(url, options);
    };

    await withServer({ authToken: "secret" }, async (baseUrl) => {
      const run = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PR-Agent-Token": "secret",
        },
        body: JSON.stringify({
          prRef: "acme/widgets#42",
          providerName: "fake",
          workspace,
        }),
      });

      assert.equal(run.status, 200);
      const review = (await run.json()) as {
        reviewId: number;
        inlineFindings: Array<Record<string, unknown>>;
      };
      assert.equal(review.inlineFindings.length, 1);

      const post = await fetch(
        `${baseUrl}/api/reviews/${review.reviewId}/post`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PR-Agent-Token": "secret",
          },
          body: JSON.stringify({
            inlineFindings: [{ ...review.inlineFindings[0], comment: "" }],
          }),
        },
      );

      assert.equal(post.status, 400);
      assert.match(
        ((await post.json()) as { error: string }).error,
        /inlineFindings\[0\] is invalid/,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

async function withServer(
  options: CreateAppServerOptions,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createAppServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createFakeGithubTokenStore() {
  let token = "";

  return {
    clearToken: async () => {
      token = "";
    },
    getToken: async () => token,
    saveToken: async (value: string) => {
      token = value;
    },
    status: async () => ({
      hasStoredGithubToken: Boolean(token),
      reason: "",
      secureStorageAvailable: true,
      storageBackend: "mock",
    }),
  };
}
