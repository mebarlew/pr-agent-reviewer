import { JsonRpcStdioClient } from "./json-rpc-stdio.js";
import { DEFAULT_PROVIDER_TIMEOUT_MS } from "./env.js";

export async function runAcpProvider(provider, { prompt, workspace }) {
  const timeoutMs = Number(provider.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  const client = new JsonRpcStdioClient({
    command: provider.command,
    args: provider.args ?? [],
    cwd: workspace,
    env: provider.env ?? {},
  });
  const chunks = [];
  const updates = [];

  client.on("notification", (message) => {
    if (message.method !== "session/update") {
      return;
    }

    const update = message.params?.update;
    if (!update) {
      return;
    }

    updates.push(update);
    collectText(update, chunks);
  });

  client.on("request", (message) => {
    if (message.method === "session/request_permission") {
      client.respond(message.id, {
        outcome: chooseRejectOutcome(message.params.options),
      });
      return;
    }

    client.respond(message.id, null);
  });

  try {
    const init = await client.request(
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

    const result = await client.request(
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
function collectText(update, chunks) {
  if (
    update?.sessionUpdate === "agent_message_chunk" &&
    update.content?.type === "text"
  ) {
    chunks.push(update.content.text);
  }
}

function chooseRejectOutcome(options = []) {
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

async function createSession(client, init, workspace, timeoutMs) {
  try {
    return await client.request(
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
      `${error.message}\nProvider may require authentication. Set "authMethod" for this provider. Available: ${methods}`,
    );
  }
}
