import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
  Tray,
} from "electron";
const { createGithubTokenStore } = require("./github-token-store.cjs");
import type { GithubTokenStore } from "../src/server.ts";

const authToken = randomUUID();
let githubTokenStore: GithubTokenStore | undefined;
let server: Server | null = null;
let serverUrl: string | null = null;
let serverStart: Promise<string> | null = null;
let mainWindow: BrowserWindow | null = null;
let windowCreation: Promise<BrowserWindow> | null = null;
let tray: Tray | undefined;
let quitting = false;

app.setName("PR Agent Reviewer");

// second-instance and activate can fire while startup is still awaiting the
// server or window, so both starters cache their in-flight promise instead
// of guarding on state that is only set once the work finishes.
function startServer(): Promise<string> {
  if (!serverStart) {
    serverStart = launchServer().catch((error) => {
      serverStart = null;
      throw error;
    });
  }

  return serverStart;
}

async function launchServer(): Promise<string> {
  const { createAppServer } = await import("../src/server.ts");
  const appServer = createAppServer({ authToken, githubTokenStore });
  server = appServer;
  appServer.listen(0, "127.0.0.1");
  await once(appServer, "listening");

  const address = appServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
  appServer.once("close", () => {
    server = null;
    serverUrl = null;
    serverStart = null;
  });

  return serverUrl;
}

function createWindow(): Promise<BrowserWindow> {
  if (!windowCreation) {
    windowCreation = openWindow().catch((error) => {
      windowCreation = null;
      throw error;
    });
  }

  return windowCreation;
}

async function openWindow(): Promise<BrowserWindow> {
  const appUrl = await startServer();

  const window = new BrowserWindow({
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
  mainWindow = window;

  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      setImmediate(() => {
        shell.openExternal(url);
      });
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isAppUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  window.once("closed", () => {
    mainWindow = null;
    windowCreation = null;
  });

  await window.loadURL(appUrl);
  return window;
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

function createTray(): void {
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

async function showMainWindow(): Promise<void> {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const window = await createWindow();
  window.show();
  window.focus();
}

function isAppUrl(url: string): boolean {
  if (!serverUrl) {
    return false;
  }

  try {
    return new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com";
  } catch {
    return false;
  }
}
