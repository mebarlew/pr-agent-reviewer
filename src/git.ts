import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchPullRequestsForBranch } from "./github.ts";
import type { BranchPullRequest } from "./github.ts";

const execFileAsync = promisify(execFile);

export interface GitHubRemoteInfo {
  host: string;
  owner: string;
  repo: string;
  fullName: string;
}

export interface GitRemote {
  name: string;
  url: string;
  github: GitHubRemoteInfo | null;
}

export interface GitHubRepoInference {
  base: GitHubRemoteInfo;
  headOwner: string;
  remotes: { name: string; fullName: string }[];
}

export interface GitState {
  root: string;
  branch: string;
  headSha: string;
  upstream: string;
  defaultBranch: string;
  isDirty: boolean;
  changedFiles: number;
  remotes: GitRemote[];
  github: GitHubRepoInference | null;
  pullRequests: BranchPullRequest[];
}

export async function readGitState(
  workspace: string,
  githubToken?: string,
): Promise<GitState> {
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

export function parseRemoteList(output: string): GitRemote[] {
  const remotes = new Map<string, GitRemote>();

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

export function parseGitHubRemoteUrl(url: string): GitHubRemoteInfo | null {
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

async function findPullRequests({
  github,
  branch,
  githubToken,
}: {
  github: GitHubRepoInference;
  branch: string;
  githubToken?: string;
}): Promise<BranchPullRequest[]> {
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

function inferGitHubRepo(remotes: GitRemote[]): GitHubRepoInference | null {
  const githubRemotes = remotes.filter(
    (remote): remote is GitRemote & { github: GitHubRemoteInfo } =>
      remote.github !== null,
  );

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

async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspace,
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
}

async function gitOptional(workspace: string, args: string[]): Promise<string> {
  try {
    return await git(workspace, args);
  } catch {
    return "";
  }
}
