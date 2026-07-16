const { mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");
import type { App, SafeStorage } from "electron";
import type {
  GithubTokenStore,
  GithubTokenStoreStatus,
} from "../src/server.ts";

const TOKEN_FILE = "github-token.safe";

interface GithubTokenStoreDeps {
  app: App;
  safeStorage: SafeStorage;
}

type StorageStatus = Omit<GithubTokenStoreStatus, "hasStoredGithubToken">;

function createGithubTokenStore({
  app,
  safeStorage,
}: GithubTokenStoreDeps): GithubTokenStore {
  const tokenPath = join(app.getPath("userData"), TOKEN_FILE);
  let cachedToken: string | undefined;

  return {
    clearToken,
    getToken,
    saveToken,
    status,
  };

  async function status(): Promise<GithubTokenStoreStatus> {
    const storage = await getStorageStatus();

    return {
      ...storage,
      hasStoredGithubToken: await hasTokenFile(),
    };
  }

  async function getToken(): Promise<string> {
    if (cachedToken !== undefined) {
      return cachedToken;
    }

    let encoded;
    try {
      encoded = await readFile(tokenPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        cachedToken = "";
        return cachedToken;
      }

      throw error;
    }

    await assertSecureStorage();

    const encrypted = Buffer.from(encoded.trim(), "base64");
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    cachedToken = decrypted.result;

    if (decrypted.shouldReEncrypt) {
      await saveToken(cachedToken);
    }

    return cachedToken;
  }

  async function saveToken(token: string): Promise<void> {
    const cleanToken = typeof token === "string" ? token.trim() : "";
    if (!cleanToken) {
      throw new Error("GitHub token is required.");
    }

    await assertSecureStorage();
    const encrypted = await safeStorage.encryptStringAsync(cleanToken);
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, encrypted.toString("base64"), { mode: 0o600 });
    cachedToken = cleanToken;
  }

  async function clearToken(): Promise<void> {
    cachedToken = "";
    await rm(tokenPath, { force: true });
  }

  async function hasTokenFile(): Promise<boolean> {
    try {
      await readFile(tokenPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  async function assertSecureStorage(): Promise<void> {
    const storage = await getStorageStatus();

    if (!storage.secureStorageAvailable) {
      throw new Error(storage.reason);
    }
  }

  async function getStorageStatus(): Promise<StorageStatus> {
    if (typeof safeStorage.isAsyncEncryptionAvailable !== "function") {
      return {
        secureStorageAvailable: false,
        storageBackend: "unavailable",
        reason: "This Electron version does not expose async secure storage.",
      };
    }

    const asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
    const storageBackend =
      typeof safeStorage.getSelectedStorageBackend === "function"
        ? safeStorage.getSelectedStorageBackend()
        : "os";

    if (!asyncAvailable) {
      return {
        secureStorageAvailable: false,
        storageBackend,
        reason: "Secure token storage is not available on this system.",
      };
    }

    if (storageBackend === "basic_text") {
      return {
        secureStorageAvailable: false,
        storageBackend,
        reason: "Refusing to store tokens with Electron basic_text storage.",
      };
    }

    return {
      secureStorageAvailable: true,
      storageBackend,
      reason: "",
    };
  }
}

module.exports = { createGithubTokenStore };
