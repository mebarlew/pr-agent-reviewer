import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { buildProviderEnv, DEFAULT_PROVIDER_TIMEOUT_MS } from "./env.js";

export class JsonRpcStdioClient extends EventEmitter {
  #child;
  #closed;
  #nextId = 1;
  #pending = new Map();
  #stderr = "";

  constructor({ command, args = [], cwd, env = {} }) {
    super();

    this.#child = spawn(command, args, {
      cwd,
      env: buildProviderEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#closed = new Promise((resolve) => {
      this.#child.once("close", resolve);
    });

    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr += chunk;
      this.emit("stderr", chunk);
    });
    this.#child.once("error", (error) => this.#rejectAll(error));
    this.#child.once("close", (code) => {
      if (code !== 0 && this.#pending.size > 0) {
        this.#rejectAll(
          new Error(`${command} exited with code ${code}.\n${this.#stderr.trim()}`),
        );
      }
    });

    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
  }

  get stderr() {
    return this.#stderr;
  }

  request(method, params, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS) {
    const id = this.#nextId;
    this.#nextId += 1;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      timeout.unref?.();

      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
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

  notify(method, params) {
    this.#write({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  respond(id, result) {
    this.#write({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  async close() {
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

  #handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", new Error(`Invalid JSON-RPC line: ${line}`));
      return;
    }

    const isResponse =
      Object.hasOwn(message, "id") &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"));

    if (isResponse) {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }

      this.#pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message ?? "JSON-RPC error"));
      } else {
        pending.resolve(message.result);
      }

      return;
    }

    if (message.method && Object.hasOwn(message, "id")) {
      this.emit("request", message);
      return;
    }

    if (message.method) {
      this.emit("notification", message);
    }
  }

  #write(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #rejectAll(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }

    this.#pending.clear();
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}
