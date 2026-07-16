import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { once } from "node:events";
import { app, BrowserWindow } from "electron";

const appRoot = resolve(__dirname, "../app/dist");
let server: Server | undefined;

app
  .whenReady()
  .then(run)
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

async function run() {
  try {
    const baseUrl = await startFixtureServer();
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 820,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    await window.loadURL(`${baseUrl}/?token=smoke-token`);
    const result = await window.webContents.executeJavaScript(
      rendererSmokeCheck(),
      true,
    );

    if (!result.ok) {
      throw new Error(result.error);
    }

    console.log("Electron smoke passed: file viewer renders changed files.");
    await window.close();
    server?.close();
    app.exit(0);
  } catch (error) {
    console.error((error as Error).message);
    if (server) {
      server.close();
    }
    app.exit(1);
  }
}

async function startFixtureServer() {
  const fixtureServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/api/config") {
        sendJson(response, {
          providers: [{ name: "codex", type: "acp", command: "codex-acp" }],
          workspace: process.cwd(),
          githubToken: {
            canPersistGithubToken: false,
            envGithubToken: false,
            hasGithubToken: false,
            hasStoredGithubToken: false,
            reason: "Secure token storage is available in the desktop app.",
            secureStorageAvailable: false,
            storageBackend: "none",
          },
        });
        return;
      }

      if (url.pathname === "/api/reviews") {
        sendJson(response, {
          reviewId: "smoke-review",
          providerName: "codex",
          pullRequest: {
            owner: "acme",
            repo: "widgets",
            number: 42,
            title: "Smoke PR",
            htmlUrl: "https://github.com/acme/widgets/pull/42",
            headSha: "abc123",
            baseRef: "main",
            headRef: "feature/smoke",
          },
          files: [
            {
              filename: "src/app.js",
              status: "modified",
              additions: 2,
              deletions: 1,
              changes: 3,
              patchAvailable: true,
              patch:
                "@@ -1,3 +1,4 @@\n context\n-old line\n+new line\n+another line",
            },
          ],
          review: {
            summary: "Smoke review summary.",
            findings: [],
            validationErrors: [],
          },
          inlineFindings: [],
          skippedFindings: [],
          markdown: "Smoke review summary.",
          agent: {
            stopReason: "complete",
            stderr: "",
          },
        });
        return;
      }

      await serveStatic(url.pathname, response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end((error as Error).message);
    }
  });
  server = fixtureServer;

  fixtureServer.listen(0, "127.0.0.1");
  await once(fixtureServer, "listening");

  const address = fixtureServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(appRoot, relativePath);
  const content = await readFile(filePath);

  response.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Cache-Control": "no-store",
  });
  response.end(content);
}

function sendJson(response: ServerResponse, body: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function mimeType(filePath: string) {
  const extension = extname(filePath);

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

function rendererSmokeCheck() {
  // The arrow function is stringified from its compiled form, so the type
  // assertions below are already erased by the time it runs in the renderer.
  return `(${async () => {
    try {
      await waitFor(
        () =>
          document.querySelector<HTMLSelectElement>("#providerName")!.options
            .length === 1,
      );

      document.querySelector<HTMLInputElement>("#prRef")!.value =
        "acme/widgets#42";
      document.querySelector<HTMLFormElement>("#reviewForm")!.requestSubmit();

      await waitFor(() =>
        document.querySelector("#counts")!.textContent!.includes("1 files"),
      );

      document.querySelector<HTMLElement>('[data-tab="files"]')!.click();
      await waitFor(() =>
        document.querySelector("#filesPanel")!.classList.contains("active"),
      );

      const fileName = document.querySelector(
        ".file-diff-header strong",
      )?.textContent;
      const activeFile = document.querySelector(
        ".file-row.active strong",
      )?.textContent;
      const summary = document.querySelector(".files-summary")?.textContent;
      const hunk = document.querySelectorAll(".diff-line.hunk").length;
      const added = document.querySelectorAll(".diff-line.added").length;
      const removed = document.querySelectorAll(".diff-line.removed").length;

      if (fileName !== "src/app.js") {
        throw new Error("Expected src/app.js, got " + fileName);
      }

      if (activeFile !== "src/app.js") {
        throw new Error("Expected active src/app.js, got " + activeFile);
      }

      if (summary !== "1 files changed / +2 -1") {
        throw new Error("Unexpected file summary: " + summary);
      }

      if (hunk !== 1 || added !== 2 || removed !== 1) {
        throw new Error(
          "Unexpected diff classes: hunk=" +
            hunk +
            " added=" +
            added +
            " removed=" +
            removed,
        );
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }

    async function waitFor(check: () => boolean) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < 5000) {
        if (check()) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error("Timed out waiting for UI state.");
    }
  }})()`;
}
