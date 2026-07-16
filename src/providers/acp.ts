import { JsonRpcStdioClient } from "./json-rpc-stdio.ts";
import { DEFAULT_PROVIDER_TIMEOUT_MS } from "./env.ts";
import type { ProviderRunOptions, ProviderSpec } from "./env.ts";

// ACP session/update payloads observed on the wire. Agents send more fields;
// only these matter here.
export interface SessionUpdate {
  sessionUpdate?: string;
  content?: { type?: string; text?: string };
}

interface PermissionOption {
  kind?: string;
  optionId?: string;
}

interface InitializeResult {
  authMethods?: { id: string }[];
}

interface SessionNewResult {
  sessionId: string;
}

interface SessionPromptResult {
  stopReason?: string;
}

export interface AcpProviderResult {
  text: string;
  stopReason?: string;
  updates: SessionUpdate[];
  stderr: string;
}

export async function runAcpProvider(
  provider: ProviderSpec,
  { prompt, workspace }: ProviderRunOptions,
): Promise<AcpProviderResult> {
  const timeoutMs = Number(provider.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  const client = new JsonRpcStdioClient({
    command: provider.command,
    args: provider.args ?? [],
    cwd: workspace,
    env: provider.env ?? {},
  });
  const chunks: string[] = [];
  const updates: SessionUpdate[] = [];

  client.on("notification", (message) => {
    if (message.method !== "session/update") {
      return;
    }

    const update = (message.params as { update?: SessionUpdate } | undefined)
      ?.update;
    if (!update) {
      return;
    }

    updates.push(update);
    collectText(update, chunks);
  });

  client.on("request", (message) => {
    if (message.method === "session/request_permission") {
      const params = message.params as { options?: PermissionOption[] };
      client.respond(message.id, {
        outcome: chooseRejectOutcome(params.options),
      });
      return;
    }

    client.respond(message.id, null);
  });

  try {
    const init = await client.request<InitializeResult>(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: {
          name: "pr-agent-reviewer",
          title: "PR Agent Reviewer",
          version: "0.1.0",
        },
      },
      timeoutMs,
    );

    if (provider.authMethod) {
      await client.request(
        "authenticate",
        { methodId: provider.authMethod },
        timeoutMs,
      );
    }

    const session = await createSession(client, init, workspace, timeoutMs);

    const result = await client.request<SessionPromptResult>(
      "session/prompt",
      {
        sessionId: session.sessionId,
        prompt: [
          {
            type: "text",
            text: prompt,
          },
        ],
      },
      timeoutMs,
    );

    return {
      text: chunks.join(""),
      stopReason: result.stopReason,
      updates,
      stderr: client.stderr,
    };
  } finally {
    await client.close();
  }
}

// Only agent message chunks belong in the answer buffer; tool call output
// can contain arbitrary source text that corrupts JSON extraction later.
function collectText(update: SessionUpdate, chunks: string[]): void {
  if (
    update?.sessionUpdate === "agent_message_chunk" &&
    update.content?.type === "text" &&
    typeof update.content.text === "string"
  ) {
    chunks.push(update.content.text);
  }
}

function chooseRejectOutcome(options: PermissionOption[] = []): {
  outcome: string;
  optionId?: string;
} {
  const reject =
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => option.kind === "reject_always");

  if (reject) {
    return {
      outcome: "selected",
      optionId: reject.optionId,
    };
  }

  return {
    outcome: "cancelled",
  };
}

async function createSession(
  client: JsonRpcStdioClient,
  init: InitializeResult,
  workspace: string,
  timeoutMs: number,
): Promise<SessionNewResult> {
  try {
    return await client.request<SessionNewResult>(
      "session/new",
      {
        cwd: workspace,
        mcpServers: [],
      },
      timeoutMs,
    );
  } catch (error) {
    if (!Array.isArray(init.authMethods) || init.authMethods.length === 0) {
      throw error;
    }

    const methods = init.authMethods.map((method) => method.id).join(", ");
    throw new Error(
      `${(error as Error).message}\nProvider may require authentication. Set "authMethod" for this provider. Available: ${methods}`,
    );
  }
}
