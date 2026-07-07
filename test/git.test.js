import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubRemoteUrl, parseRemoteList } from "../src/git.js";

test("parseGitHubRemoteUrl supports GitHub SSH remotes", () => {
  assert.deepEqual(parseGitHubRemoteUrl("git@github.com:acme/widgets.git"), {
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    fullName: "acme/widgets",
  });
});

test("parseGitHubRemoteUrl supports GitHub HTTPS remotes", () => {
  assert.deepEqual(parseGitHubRemoteUrl("https://github.com/acme/widgets.git"), {
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    fullName: "acme/widgets",
  });
});

test("parseGitHubRemoteUrl supports dotted repo names", () => {
  assert.deepEqual(parseGitHubRemoteUrl("git@github.com:acme/widgets.api.git"), {
    host: "github.com",
    owner: "acme",
    repo: "widgets.api",
    fullName: "acme/widgets.api",
  });
});

test("parseRemoteList keeps fetch remotes with parsed GitHub metadata", () => {
  assert.deepEqual(
    parseRemoteList(`origin  git@github.com:acme/widgets.git (fetch)
origin  git@github.com:acme/widgets.git (push)
upstream  https://github.com/example/widgets.git (fetch)`),
    [
      {
        name: "origin",
        url: "git@github.com:acme/widgets.git",
        github: {
          host: "github.com",
          owner: "acme",
          repo: "widgets",
          fullName: "acme/widgets",
        },
      },
      {
        name: "upstream",
        url: "https://github.com/example/widgets.git",
        github: {
          host: "github.com",
          owner: "example",
          repo: "widgets",
          fullName: "example/widgets",
        },
      },
    ],
  );
});
