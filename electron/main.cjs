const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
  Tray,
} = require("electron");
const { createGithubTokenStore } = require("./github-token-store.cjs");

const authToken = randomUUID();
let githubTokenStore;
let server;
let serverUrl;
let serverStart;
let mainWindow;
let windowCreation;
let tray;
let quitting = false;

app.setName("PR Agent Reviewer");

// second-instance and activate can fire while startup is still awaiting the
// server or window, so both starters cache their in-flight promise instead
// of guarding on state that is only set once the work finishes.
function startServer() {
  if (!serverStart) {
    serverStart = launchServer().catch((error) => {
      serverStart = null;
      throw error;
    });
  }

  return serverStart;
}

async function launchServer() {
  const { createAppServer } = await import("../src/server.js");
  server = createAppServer({ authToken, githubTokenStore });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  serverUrl = `http://127.0.0.1:${address.port}`;
  server.once("close", () => {
    server = null;
    serverUrl = null;
    serverStart = null;
  });

  return serverUrl;
}

function createWindow() {
  if (!windowCreation) {
    windowCreation = openWindow().catch((error) => {
      windowCreation = null;
      throw error;
    });
  }

  return windowCreation;
}

async function openWindow() {
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
      // The renderer keeps polling for resolved review threads while the
      // window is hidden in the tray.
      backgroundThrottling: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
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
    windowCreation = null;
  });

  await mainWindow.loadURL(appUrl);
}

// With close-to-tray the process lingers after the window is gone, so a
// relaunch must re-show the existing instance instead of starting a
// second server, tray, and poller.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    githubTokenStore = createGithubTokenStore({ app, safeStorage });

    ipcMain.handle("auth-token", () => authToken);
    ipcMain.handle("show-window", () => showMainWindow());

    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => {
        callback(false);
      },
    );

    await createWindow();
    createTray();

    app.on("activate", async () => {
      await showMainWindow();
    });
  });
}

// Closing the window hides it to the tray; the app only exits via
// the tray menu or an explicit quit.
app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  quitting = true;

  if (server) {
    server.close();
    server = null;
    serverUrl = null;
  }
});

function createTray() {
  tray = new Tray(join(__dirname, "tray-icon.png"));
  tray.setToolTip("PR Agent Reviewer");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open PR Agent Reviewer",
        click: () => showMainWindow(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]),
  );
  tray.on("click", () => showMainWindow());
}

async function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  await createWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

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
