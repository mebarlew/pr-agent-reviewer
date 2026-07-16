import type { RequestOptions } from "./types";

let authToken = "";

export async function initAuthToken(): Promise<void> {
  if (window.prAgent?.getAuthToken) {
    authToken = await window.prAgent.getAuthToken();
    return;
  }

  authToken = new URLSearchParams(window.location.search).get("token") ?? "";
}

export async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (authToken) {
    headers["X-PR-Agent-Token"] = authToken;
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}
