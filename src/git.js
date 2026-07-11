import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchPullRequestsForBranch } from "./github.js";

const execFileAsync = promisify(execFile);

export async function readGitState(workspace, githubToken) {
  const root = await git(workspace, ["rev-parse", "--show-toplevel"]);
  const [branch, headSha, statusOutput, remoteOutput, upstream, defaultBranch] =
    await Promise.all([
      git(root, ["branch", "--show-current"]),
      gitOptional(root, ["rev-parse", "HEAD"]),
      git(root, ["status", "--short"]),
      git(root, ["remote", "-v"]),
      gitOptional(root, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]),
      gitOptional(root, [
        "symbolic-ref",
        "--short",
        "refs/remotes/origin/HEAD",
      ]),
    ]);
  const remotes = parseRemoteList(remoteOutput);
  const github = inferGitHubRepo(remotes);
  const pullRequests = github
    ? await findPullRequests({ github, branch, githubToken })
    : [];

  return {
    root,
    branch,
    headSha,
    upstream,
    defaultBranch: defaultBranch.replace(/^origin\//, ""),
    isDirty: statusOutput.length > 0,
    changedFiles: statusOutput ? statusOutput.split("\n").length : 0,
    remotes,
    github,
    pullRequests,
  };
}

export function parseRemoteList(output) {
  const remotes = new Map();

  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match || match[3] !== "fetch") {
      continue;
    }

    remotes.set(match[1], {
      name: match[1],
      url: match[2],
      github: parseGitHubRemoteUrl(match[2]),
    });
  }

  return [...remotes.values()];
}

export function parseGitHubRemoteUrl(url) {
  const patterns = [
    /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/,
    /^https:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);

    if (match && match[1] === "github.com") {
      return {
        host: match[1],
        owner: match[2],
        repo: match[3],
        fullName: `${match[2]}/${match[3]}`,
      };
    }
  }

  return null;
}

async function findPullRequests({ github, branch, githubToken }) {
  if (!branch) {
    return [];
  }

  try {
    return await fetchPullRequestsForBranch(
      {
        owner: github.base.owner,
        repo: github.base.repo,
        headOwner: github.headOwner,
        branch,
      },
      githubToken,
    );
  } catch {
    return [];
  }
}

function inferGitHubRepo(remotes) {
  const githubRemotes = remotes.filter((remote) => remote.github);

  if (githubRemotes.length === 0) {
    return null;
  }

  const origin = githubRemotes.find((remote) => remote.name === "origin");
  const upstream = githubRemotes.find((remote) => remote.name === "upstream");
  const baseRemote = upstream ?? origin ?? githubRemotes[0];
  const headRemote = origin ?? baseRemote;

  return {
    base: baseRemote.github,
    headOwner: headRemote.github.owner,
    remotes: githubRemotes.map((remote) => ({
      name: remote.name,
      fullName: remote.github.fullName,
    })),
  };
}

async function git(workspace, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspace,
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
}

async function gitOptional(workspace, args) {
  try {
    return await git(workspace, args);
  } catch {
    return "";
  }
}
