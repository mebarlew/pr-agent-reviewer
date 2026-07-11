import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.js";
import { readGitState } from "./git.js";
import {
  fetchOpenPullRequestsForRepo,
  fetchReviewThreads,
  parsePullRequestRef,
  parseRepositoryRef,
} from "./github.js";
import { normalizeFinding } from "./review/schema.js";
import { postReview, runReview } from "./review/service.js";

const appRoot = resolve(fileURLToPath(new URL("../app", import.meta.url)));
const reviews = new Map();
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const MAX_CACHED_REVIEWS = 50;
const REVIEW_TTL_MS = 60 * 60 * 1000;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5173);
  const authToken = randomUUID();
  const server = createAppServer({ authToken });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `PR Agent Reviewer running at http://127.0.0.1:${port}/?token=${authToken}`,
    );
  });
}

export function createAppServer({
  authToken = randomUUID(),
  githubTokenStore = null,
  requireAuth = true,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        if (!isLoopbackRequest(request)) {
          sendJson(response, 403, { error: "Forbidden origin" });
          return;
        }

        if (requireAuth && !isAuthorized(request, authToken)) {
          sendJson(response, 401, { error: "Unauthorized" });
          return;
        }

        if (
          request.method !== "GET" &&
          request.method !== "DELETE" &&
          !hasJsonContentType(request)
        ) {
          sendJson(response, 415, {
            error: "Expected application/json request body",
          });
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        await handleConfig(response, githubTokenStore);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/git") {
        await handleReadGit(request, response, maxBodyBytes, githubTokenStore);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/github/pulls") {
        await handleListPullRequests(
          request,
          response,
          maxBodyBytes,
          githubTokenStore,
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/github-token") {
        await handleGithubTokenStatus(response, githubTokenStore);
        return;
      }

      if (request.method === "PUT" && url.pathname === "/api/github-token") {
        await handleSaveGithubToken(
          request,
          response,
          maxBodyBytes,
          githubTokenStore,
        );
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/github-token") {
        await handleClearGithubToken(response, githubTokenStore);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/reviews") {
        await handleRunReview(
          request,
          response,
          maxBodyBytes,
          githubTokenStore,
        );
        return;
      }

      const postMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/post$/);
      if (request.method === "POST" && postMatch) {
        await handlePostReview(
          postMatch[1],
          request,
          response,
          maxBodyBytes,
          githubTokenStore,
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/review-threads") {
        await handleReviewThreads(
          request,
          response,
          maxBodyBytes,
          githubTokenStore,
        );
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      if (request.method === "GET") {
        await serveStatic(url.pathname, response);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, error.statusCode ?? 500, { error: error.message });
    }
  });
}

async function handleConfig(response, githubTokenStore) {
  const config = await loadConfig();
  const providers = Object.entries(config.providers).map(
    ([name, provider]) => ({
      name,
      type: provider.type,
      command: provider.command,
    }),
  );
  const githubToken = await getGithubTokenStatus(githubTokenStore);

  sendJson(response, 200, {
    providers,
    workspace: cwd(),
    githubToken,
    hasGithubToken: githubToken.hasGithubToken,
  });
}

async function handleRunReview(
  request,
  response,
  maxBodyBytes,
  githubTokenStore,
) {
  const body = await readJson(request, maxBodyBytes);
  const providerName = requiredString(
    body.providerName,
    "providerName is required",
  );
  const pullRequest = parsePullRequestRef(
    requiredString(body.prRef, "prRef is required"),
  );
  const githubToken = await resolveGithubToken(body, githubTokenStore);
  const result = await runReview({
    pullRequest,
    providerName,
    workspace: body.workspace || cwd(),
    githubToken,
  });
  const reviewId = randomUUID();

  cacheReview(reviewId, result);

  sendJson(response, 200, {
    reviewId,
    ...result,
  });
}

async function handleReadGit(
  request,
  response,
  maxBodyBytes,
  githubTokenStore,
) {
  const body = await readJson(request, maxBodyBytes);
  const githubToken = await resolveGithubToken(body, githubTokenStore);
  const state = await readGitState(body.workspace || cwd(), githubToken);

  sendJson(response, 200, state);
}

async function handleListPullRequests(
  request,
  response,
  maxBodyBytes,
  githubTokenStore,
) {
  const body = await readJson(request, maxBodyBytes);
  const repo = parseRepositoryRef(
    requiredString(body.repoRef, "repoRef is required"),
  );
  const githubToken = await resolveGithubToken(body, githubTokenStore);
  const result = await fetchOpenPullRequestsForRepo(repo, githubToken);

  sendJson(response, 200, result);
}

async function handleGithubTokenStatus(response, githubTokenStore) {
  sendJson(response, 200, await getGithubTokenStatus(githubTokenStore));
}

async function handleSaveGithubToken(
  request,
  response,
  maxBodyBytes,
  githubTokenStore,
) {
  if (!githubTokenStore) {
    sendJson(response, 501, {
      error: "Secure token storage is available in the desktop app.",
    });
    return;
  }

  const body = await readJson(request, maxBodyBytes);
  await githubTokenStore.saveToken(
    requiredString(body.githubToken, "GitHub token is required"),
  );
  sendJson(response, 200, await getGithubTokenStatus(githubTokenStore));
}

async function handleClearGithubToken(response, githubTokenStore) {
  if (githubTokenStore) {
    await githubTokenStore.clearToken();
  }

  sendJson(response, 200, await getGithubTokenStatus(githubTokenStore));
}

async function handlePostReview(
  reviewId,
  request,
  response,
  maxBodyBytes,
  githubTokenStore,
) {
  const cached = getCachedReview(reviewId);
  if (!cached) {
    sendJson(response, 404, { error: "Review expired or unknown" });
    return;
  }

  const body = await readJson(request, maxBodyBytes);
  const review = {
    ...cached.review,
    summary:
      typeof body.summary === "string" ? body.summary : cached.review.summary,
  };
  const inlineFindings = cleanFindings(
    body.inlineFindings,
    cached.inlineFindings,
  );
  const skippedFindings = cleanFindings(
    body.skippedFindings,
    cached.skippedFindings,
  );
  const githubToken = await resolveGithubToken(body, githubTokenStore);
  const posted = await postReview({
    pullRequest: cached.pullRequest,
    providerName: cached.providerName,
    review,
    inlineFindings,
    skippedFindings,
    githubToken,
  });

  sendJson(response, 200, posted);
}

async function handleReviewThreads(
  request,
  response,
  maxBodyBytes,
  githubTokenStore,
) {
  const body = await readJson(request, maxBodyBytes);
  const pullRequest = parsePullRequestRef(
    requiredString(body.prRef, "prRef is required"),
  );
  if (!Number.isInteger(body.reviewId)) {
    sendJson(response, 400, { error: "reviewId must be an integer" });
    return;
  }

  const githubToken = await resolveGithubToken(body, githubTokenStore);
  const threads = await fetchReviewThreads(
    pullRequest,
    body.reviewId,
    githubToken,
  );

  sendJson(response, 200, { threads });
}

async function serveStatic(pathname, response) {
  let relativePath;
  try {
    relativePath =
      pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    sendJson(response, 400, { error: "Invalid path" });
    return;
  }

  const filePath = resolve(appRoot, relativePath);
  const staticRelativePath = relative(appRoot, filePath);

  if (staticRelativePath.startsWith("..") || isAbsolute(staticRelativePath)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeType(filePath),
      "Cache-Control": "no-store",
      ...securityHeaders(),
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function cacheReview(reviewId, result) {
  const now = Date.now();
  pruneReviews(now);

  reviews.set(reviewId, {
    result,
    expiresAt: now + REVIEW_TTL_MS,
  });

  while (reviews.size > MAX_CACHED_REVIEWS) {
    const oldest = reviews.keys().next().value;
    reviews.delete(oldest);
  }
}

function getCachedReview(reviewId) {
  pruneReviews(Date.now());

  return reviews.get(reviewId)?.result ?? null;
}

function pruneReviews(now) {
  for (const [reviewId, cached] of reviews) {
    if (cached.expiresAt <= now) {
      reviews.delete(reviewId);
    }
  }
}

function cleanFindings(input, fallback) {
  if (!Array.isArray(input)) {
    return fallback;
  }

  const allowed = new Set(fallback.map((finding) => findingKey(finding)));

  return input
    .map((finding) => cleanFinding(finding))
    .filter((finding) => finding && allowed.has(findingKey(finding)));
}

function cleanFinding(finding) {
  return normalizeFinding(finding);
}

async function resolveGithubToken(body, githubTokenStore) {
  const requestToken =
    typeof body.githubToken === "string" ? body.githubToken.trim() : "";
  if (requestToken) {
    return requestToken;
  }

  if (!githubTokenStore) {
    return process.env.GITHUB_TOKEN;
  }

  try {
    const storedToken = await githubTokenStore.getToken();
    return storedToken || process.env.GITHUB_TOKEN;
  } catch (error) {
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN;
    }

    throw error;
  }
}

async function getGithubTokenStatus(githubTokenStore) {
  const envGithubToken = Boolean(process.env.GITHUB_TOKEN);
  const defaultStatus = {
    canPersistGithubToken: false,
    envGithubToken,
    hasGithubToken: envGithubToken,
    hasStoredGithubToken: false,
    reason: "Secure token storage is available in the desktop app.",
    secureStorageAvailable: false,
    storageBackend: "none",
  };

  if (!githubTokenStore) {
    return defaultStatus;
  }

  const status = await githubTokenStore.status();
  const storedGithubTokenAvailable =
    status.secureStorageAvailable && status.hasStoredGithubToken;

  return {
    canPersistGithubToken: status.secureStorageAvailable,
    envGithubToken,
    hasGithubToken: envGithubToken || storedGithubTokenAvailable,
    hasStoredGithubToken: status.hasStoredGithubToken,
    reason: status.reason,
    secureStorageAvailable: status.secureStorageAvailable,
    storageBackend: status.storageBackend,
  };
}

function findingKey(finding) {
  return `${finding.path}:${finding.line}`;
}

function requiredString(value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value.trim();
}

function readJson(request, maxBodyBytes) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    let bytes = 0;
    let settled = false;

    function fail(error) {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    }

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) {
        return;
      }

      bytes += Buffer.byteLength(chunk, "utf8");

      if (bytes > maxBodyBytes) {
        fail(
          new HttpError(
            413,
            `Request body too large. Max ${maxBodyBytes} bytes.`,
          ),
        );
        return;
      }

      raw += chunk;
    });
    request.on("end", () => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new HttpError(400, `Invalid JSON body: ${error.message}`));
      }
    });
    request.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  response.end(JSON.stringify(body));
}

function securityHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function mimeType(filePath) {
  const extension = extname(filePath);

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

function isLoopbackRequest(request) {
  return (
    isLoopbackHost(request.headers.host) &&
    isAllowedOrigin(request.headers.origin)
  );
}

function isLoopbackHost(host) {
  if (!host) {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isAuthorized(request, authToken) {
  const header = request.headers["x-pr-agent-token"];
  const value = Array.isArray(header) ? header[0] : header;

  if (!value || !authToken) {
    return false;
  }

  const actual = Buffer.from(value);
  const expected = Buffer.from(authToken);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hasJsonContentType(request) {
  const header = request.headers["content-type"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.toLowerCase().split(";")[0].trim() === "application/json";
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
