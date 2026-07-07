import { cwd } from "node:process";
import { parsePullRequestRef } from "./github.js";
import { postReview, runReview } from "./review/service.js";

const usage = `Usage:
  pr-agent-review review <pr-url|owner/repo#number> --provider <name> [--post] [--workspace <path>] [--config <path>]

Examples:
  pr-agent-review review https://github.com/acme/app/pull/42 --provider codex
  pr-agent-review review acme/app#42 --provider claude --post

Environment:
  GITHUB_TOKEN is required for private repos and for --post.
`;

export async function main(argv) {
  const args = parseArgs(argv);

  if (args.help || args._[0] !== "review" || !args._[1]) {
    console.log(usage);
    return;
  }

  const providerName = required(args.provider, "--provider is required");
  const pullRequest = parsePullRequestRef(args._[1]);
  const result = await runReview({
    pullRequest,
    providerName,
    workspace: args.workspace ?? cwd(),
    configPath: args.config,
    githubToken: process.env.GITHUB_TOKEN,
  });

  if (args.post) {
    const posted = await postReview({
      pullRequest: result.pullRequest,
      providerName,
      review: result.review,
      inlineFindings: result.inlineFindings,
      skippedFindings: result.skippedFindings,
      githubToken: process.env.GITHUB_TOKEN,
    });

    console.log(
      `Posted ${posted.inlineComments} inline comments and ${posted.summaryComments} summary comments.`,
    );
    return;
  }

  console.log(result.markdown);
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--post") {
      parsed.post = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }

      parsed[toCamelCase(key)] = value;
      index += 1;
      continue;
    }

    parsed._.push(arg);
  }

  return parsed;
}

function required(value, message) {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function toCamelCase(value) {
  return value.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
