const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const { app, BrowserWindow, ipcMain, safeStorage, session, shell } = require("electron");
const { createGithubTokenStore } = require("./github-token-store.cjs");

const authToken = randomUUID();
let githubTokenStore;
let server;
let serverUrl;
let mainWindow;

app.setName("PR Agent Reviewer");

async function startServer() {
  if (serverUrl) {
    return serverUrl;
  }

  const { createAppServer } = await import("../src/server.js");
  server = createAppServer({ authToken, githubTokenStore });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  serverUrl = `http://127.0.0.1:${address.port}`;
  server.once("close", () => {
    server = null;
    serverUrl = null;
  });

  return serverUrl;
}

async function createWindow() {
  const appUrl = await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    title: "PR Agent Reviewer",
    backgroundColor: "#101115",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      setImmediate(() => {
        shell.openExternal(url);
      });
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isAppUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  mainWindow.once("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(appUrl);
}

app.whenReady().then(async () => {
  githubTokenStore = createGithubTokenStore({ app, safeStorage });

  ipcMain.handle("auth-token", () => authToken);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (server) {
    server.close();
    server = null;
    serverUrl = null;
  }
});

function isAppUrl(url) {
  if (!serverUrl) {
    return false;
  }

  try {
    return new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com";
  } catch {
    return false;
  }
}
