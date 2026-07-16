import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });

input.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [],
      },
    });
    return;
  }

  if (message.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: "fake-session",
      },
    });
    return;
  }

  if (message.method === "session/prompt") {
    if (message.params.prompt[0].text.includes("noisy")) {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
        },
      });
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "fake-tool-call",
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "function boom() { return { nested: {} }; }",
                },
              },
            ],
          },
        },
      });
    }

    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: message.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "fake-message",
          content: {
            type: "text",
            text: JSON.stringify({
              summary: "Fake review complete.",
              findings: [
                {
                  path: "src/app.js",
                  line: 2,
                  severity: "bug",
                  comment: "This fake finding proves the ACP path works.",
                },
              ],
            }),
          },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "end_turn",
      },
    });
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
