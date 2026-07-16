import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { buildProviderEnv, DEFAULT_PROVIDER_TIMEOUT_MS } from "./env.ts";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// A message read off the agent's stdout. The shape is only trusted after the
// structural checks in #handleLine.
interface JsonRpcIncoming {
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { message?: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface JsonRpcStdioClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

type JsonRpcStdioClientEvents = {
  notification: [JsonRpcNotification];
  request: [JsonRpcRequest];
  stderr: [string];
  protocolError: [Error];
};

export class JsonRpcStdioClient extends EventEmitter<JsonRpcStdioClientEvents> {
  #child: ChildProcessWithoutNullStreams;
  #closed: Promise<unknown>;
  #nextId = 1;
  #pending = new Map<number | string, PendingRequest>();
  #stderr = "";

  constructor({
    command,
    args = [],
    cwd,
    env = {},
  }: JsonRpcStdioClientOptions) {
    super();

    this.#child = spawn(command, args, {
      cwd,
      env: buildProviderEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#closed = new Promise((resolve) => {
      this.#child.once("close", resolve);
    });

    this.#child.stdin.on("error", () => {
      // The child may exit before draining stdin; pending requests are rejected on close.
    });
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      this.#stderr += chunk;
      this.emit("stderr", chunk);
    });
    this.#child.once("error", (error) => this.#rejectAll(error));
    this.#child.once("close", (code) => {
      if (this.#pending.size > 0) {
        this.#rejectAll(
          new Error(
            `${command} exited with code ${code} before responding.\n${this.#stderr.trim()}`,
          ),
        );
      }
    });

    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
  }

  get stderr(): string {
    return this.#stderr;
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
  ): Promise<T> {
    const id = this.#nextId;
    this.#nextId += 1;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      timeout.unref?.();

      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        this.#write({
          jsonrpc: "2.0",
          id,
          method,
          params,
        });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.#write({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  respond(id: number | string, result: unknown): void {
    this.#write({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  async close(): Promise<void> {
    try {
      this.#child.stdin.end();
    } catch {
      // Process may already be gone.
    }

    if (!this.#child.killed && this.#child.exitCode === null) {
      this.#child.kill("SIGTERM");
    }

    const killTimer = setTimeout(() => {
      if (!this.#child.killed && this.#child.exitCode === null) {
        this.#child.kill("SIGKILL");
      }
    }, 2000);

    killTimer.unref?.();

    await Promise.race([this.#closed, wait(3000)]);
    clearTimeout(killTimer);
  }

  #handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: JsonRpcIncoming;
    try {
      message = JSON.parse(line) as JsonRpcIncoming;
    } catch {
      this.emit("protocolError", new Error(`Invalid JSON-RPC line: ${line}`));
      return;
    }

    const isResponse =
      Object.hasOwn(message, "id") &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"));

    if (isResponse) {
      const pending = this.#pending.get(message.id as number | string);
      if (!pending) {
        return;
      }

      this.#pending.delete(message.id as number | string);

      if (message.error) {
        pending.reject(new Error(message.error.message ?? "JSON-RPC error"));
      } else {
        pending.resolve(message.result);
      }

      return;
    }

    if (message.method && Object.hasOwn(message, "id")) {
      this.emit("request", message as JsonRpcRequest);
      return;
    }

    if (message.method) {
      this.emit("notification", message as JsonRpcNotification);
    }
  }

  #write(message: object): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }

    this.#pending.clear();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}
