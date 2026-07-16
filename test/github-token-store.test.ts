import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createGithubTokenStore,
} = require("../electron/github-token-store.cjs");

test("github token store encrypts, reads, and clears a token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pr-agent-token-"));
  const store = createGithubTokenStore({
    app: {
      getPath: () => dir,
    },
    safeStorage: createFakeSafeStorage(),
  });

  try {
    assert.equal((await store.status()).hasStoredGithubToken, false);

    await store.saveToken("  ghp_secret  ");

    assert.equal((await store.status()).hasStoredGithubToken, true);
    assert.equal(await store.getToken(), "ghp_secret");

    await store.clearToken();

    assert.equal((await store.status()).hasStoredGithubToken, false);
    assert.equal(await store.getToken(), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("github token store refuses basic_text storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pr-agent-token-"));
  const store = createGithubTokenStore({
    app: {
      getPath: () => dir,
    },
    safeStorage: createFakeSafeStorage({ storageBackend: "basic_text" }),
  });

  try {
    const status = await store.status();
    assert.equal(status.secureStorageAvailable, false);

    await assert.rejects(
      () => store.saveToken("ghp_secret"),
      /Refusing to store tokens/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function createFakeSafeStorage({ storageBackend = "mock" } = {}) {
  return {
    decryptStringAsync: async (encrypted: Buffer) => ({
      result: Buffer.from(encrypted.toString(), "base64").toString("utf8"),
      shouldReEncrypt: false,
    }),
    encryptStringAsync: async (plainText: string) =>
      Buffer.from(Buffer.from(plainText).toString("base64")),
    getSelectedStorageBackend: () => storageBackend,
    isAsyncEncryptionAvailable: async () => true,
  };
}
