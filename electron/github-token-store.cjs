const { mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");

const TOKEN_FILE = "github-token.safe";

function createGithubTokenStore({ app, safeStorage }) {
  const tokenPath = join(app.getPath("userData"), TOKEN_FILE);
  let cachedToken;

  return {
    clearToken,
    getToken,
    saveToken,
    status,
  };

  async function status() {
    const storage = await getStorageStatus();

    return {
      ...storage,
      hasStoredGithubToken: await hasTokenFile(),
    };
  }

  async function getToken() {
    if (cachedToken !== undefined) {
      return cachedToken;
    }

    let encoded;
    try {
      encoded = await readFile(tokenPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
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

  async function saveToken(token) {
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

  async function clearToken() {
    cachedToken = "";
    await rm(tokenPath, { force: true });
  }

  async function hasTokenFile() {
    try {
      await readFile(tokenPath);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  async function assertSecureStorage() {
    const storage = await getStorageStatus();

    if (!storage.secureStorageAvailable) {
      throw new Error(storage.reason);
    }
  }

  async function getStorageStatus() {
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

module.exports = {
  createGithubTokenStore,
};
