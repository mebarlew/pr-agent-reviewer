import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createAppServer } from "../src/server.js";

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

    const payload = await authorized.json();
    assert.ok(Array.isArray(payload.providers));
    assert.match(authorized.headers.get("content-security-policy"), /default-src 'self'/);
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
  await withServer({ authToken: "secret", maxBodyBytes: 32 }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/git`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PR-Agent-Token": "secret",
      },
      body: JSON.stringify({ workspace: "x".repeat(64) }),
    });

    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /Request body too large/);
  });
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
    assert.match((await response.json()).error, /Invalid JSON body/);
  });
});

test("github token endpoints save and clear desktop tokens", async () => {
  const githubTokenStore = createFakeGithubTokenStore();

  await withServer({ authToken: "secret", githubTokenStore }, async (baseUrl) => {
    const saved = await fetch(`${baseUrl}/api/github-token`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-PR-Agent-Token": "secret",
      },
      body: JSON.stringify({ githubToken: "ghp_secret" }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).hasStoredGithubToken, true);
    assert.equal(await githubTokenStore.getToken(), "ghp_secret");

    const cleared = await fetch(`${baseUrl}/api/github-token`, {
      method: "DELETE",
      headers: {
        "X-PR-Agent-Token": "secret",
      },
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).hasStoredGithubToken, false);
  });
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
  };

  await withServer({ authToken: "secret", githubTokenStore }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`, {
      headers: {
        "X-PR-Agent-Token": "secret",
      },
    });

    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.githubToken.hasStoredGithubToken, true);
    assert.equal(payload.githubToken.hasGithubToken, false);
  });
});

async function withServer(options, run) {
  const server = createAppServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

function createFakeGithubTokenStore() {
  let token = "";

  return {
    clearToken: async () => {
      token = "";
    },
    getToken: async () => token,
    saveToken: async (value) => {
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
