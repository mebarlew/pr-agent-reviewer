const state = {
  files: [],
  githubTokenStatus: null,
  reviewId: null,
  pullRequest: null,
  repoPullRequests: [],
  selectedFileIndex: 0,
};

let authToken = "";

const elements = {
  commentsPanel: document.querySelector("#commentsPanel"),
  clearGithubTokenButton: document.querySelector("#clearGithubTokenButton"),
  copyPromptButton: document.querySelector("#copyPromptButton"),
  counts: document.querySelector("#counts"),
  filesPanel: document.querySelector("#filesPanel"),
  gitPanel: document.querySelector("#gitPanel"),
  githubToken: document.querySelector("#githubToken"),
  githubTokenStatus: document.querySelector("#githubTokenStatus"),
  loadRepoButton: document.querySelector("#loadRepoButton"),
  postButton: document.querySelector("#postButton"),
  providerName: document.querySelector("#providerName"),
  providerStrip: document.querySelector("#providerStrip"),
  promptPanel: document.querySelector("#promptPanel"),
  prRef: document.querySelector("#prRef"),
  prTitle: document.querySelector("#prTitle"),
  repoMeta: document.querySelector("#repoMeta"),
  repoPrList: document.querySelector("#repoPrList"),
  repoRef: document.querySelector("#repoRef"),
  readGitButton: document.querySelector("#readGitButton"),
  reviewForm: document.querySelector("#reviewForm"),
  runButton: document.querySelector("#runButton"),
  saveGithubTokenButton: document.querySelector("#saveGithubTokenButton"),
  statusText: document.querySelector("#statusText"),
  summary: document.querySelector("#summary"),
  workspace: document.querySelector("#workspace"),
};

const findingTemplate = document.querySelector("#findingTemplate");

init();

async function init() {
  bindEvents();
  setBusy(true, "Loading");

  try {
    authToken = await resolveAuthToken();
    const config = await requestJson("/api/config");
    renderProviders(config.providers);
    elements.workspace.value = config.workspace;
    renderGithubTokenStatus(config.githubToken);
    setBusy(false, "Ready");
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function resolveAuthToken() {
  if (window.prAgent?.getAuthToken) {
    return window.prAgent.getAuthToken();
  }

  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function bindEvents() {
  elements.reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isRepoRef(elements.prRef.value)) {
      elements.repoRef.value = elements.prRef.value;
      await loadRepositoryPullRequests();
      return;
    }

    await runReview();
  });

  elements.loadRepoButton.addEventListener("click", async () => {
    await loadRepositoryPullRequests();
  });

  elements.readGitButton.addEventListener("click", async () => {
    await readGitWorkspace();
  });

  elements.saveGithubTokenButton.addEventListener("click", async () => {
    await saveGithubToken();
  });

  elements.clearGithubTokenButton.addEventListener("click", async () => {
    await clearGithubToken();
  });

  elements.copyPromptButton.addEventListener("click", async () => {
    await copyFixPrompt();
  });

  elements.postButton.addEventListener("click", async () => {
    await postSelected();
  });

  elements.summary.addEventListener("input", refreshFixPrompt);
  elements.commentsPanel.addEventListener("input", refreshFixPrompt);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
}

async function saveGithubToken() {
  const githubToken = elements.githubToken.value.trim();
  if (!githubToken) {
    elements.githubTokenStatus.textContent = "Enter a token to save.";
    return;
  }

  setBusy(true, "Saving token");

  try {
    const status = await requestJson("/api/github-token", {
      method: "PUT",
      body: {
        githubToken,
      },
    });

    elements.githubToken.value = "";
    renderGithubTokenStatus(status);
    setBusy(false, "Token saved");
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function clearGithubToken() {
  setBusy(true, "Forgetting token");

  try {
    const status = await requestJson("/api/github-token", {
      method: "DELETE",
    });

    elements.githubToken.value = "";
    renderGithubTokenStatus(status);
    setBusy(false, "Token forgotten");
  } catch (error) {
    setBusy(false, error.message);
  }
}

function renderGithubTokenStatus(status) {
  state.githubTokenStatus = status ?? null;

  if (!status) {
    elements.githubToken.placeholder = "optional";
    elements.githubTokenStatus.textContent = "Token status unavailable";
    elements.saveGithubTokenButton.disabled = true;
    elements.clearGithubTokenButton.disabled = true;
    return;
  }

  elements.saveGithubTokenButton.disabled = !status.canPersistGithubToken;
  elements.clearGithubTokenButton.disabled = !status.hasStoredGithubToken;
  elements.githubToken.placeholder = status.hasGithubToken ? "token available" : "optional";

  if (status.hasStoredGithubToken && status.canPersistGithubToken) {
    elements.githubTokenStatus.textContent = "Saved token";
    return;
  }

  if (status.hasStoredGithubToken) {
    elements.githubTokenStatus.textContent = status.reason;
    return;
  }

  if (status.envGithubToken) {
    elements.githubTokenStatus.textContent = "Using env token";
    return;
  }

  elements.githubTokenStatus.textContent = status.canPersistGithubToken
    ? "No saved token"
    : status.reason;
}

async function readGitWorkspace() {
  const workspace = elements.workspace.value.trim();
  if (!workspace) {
    renderGitError("Enter a workspace path.");
    return;
  }

  setBusy(true, "Reading git");

  try {
    const result = await requestJson("/api/git", {
      method: "POST",
      body: {
        workspace,
        githubToken: githubTokenOverride(),
      },
    });

    renderGitState(result);
    setBusy(false, result.pullRequests.length > 0 ? "Local PR found" : "Git read");
  } catch (error) {
    renderGitError(error.message);
    setBusy(false, error.message);
  }
}

async function loadRepositoryPullRequests() {
  const repoRef = (elements.repoRef.value || elements.prRef.value).trim();
  if (!repoRef) {
    elements.repoMeta.textContent = "Enter a repo or PR link.";
    return;
  }

  setBusy(true, "Loading PRs");
  elements.repoPrList.replaceChildren();

  try {
    const result = await requestJson("/api/github/pulls", {
      method: "POST",
      body: {
        repoRef,
        githubToken: githubTokenOverride(),
      },
    });

    state.repoPullRequests = result.pullRequests;
    elements.repoRef.value = result.repository.fullName;
    elements.repoMeta.textContent = `${result.repository.fullName} / ${result.pullRequests.length} open PRs`;
    renderRepoPullRequests();
    setBusy(false, "Choose a PR");
  } catch (error) {
    setBusy(false, error.message);
    elements.repoMeta.textContent = error.message;
  }
}

async function runReview() {
  clearResults();
  setBusy(true, "Running review");

  try {
    const result = await requestJson("/api/reviews", {
      method: "POST",
      body: {
        prRef: elements.prRef.value,
        providerName: elements.providerName.value,
        workspace: elements.workspace.value,
        githubToken: githubTokenOverride(),
      },
    });

    state.reviewId = result.reviewId;
    state.files = Array.isArray(result.files) ? result.files : [];
    state.pullRequest = result.pullRequest;
    state.selectedFileIndex = 0;

    elements.prTitle.textContent = result.pullRequest.title;
    elements.summary.disabled = false;
    elements.summary.value = result.review.summary;
    const invalidCount = result.review.validationErrors?.length ?? 0;
    elements.counts.textContent = invalidCount
      ? `${result.review.findings.length} findings, ${state.files.length} files, ${invalidCount} invalid`
      : `${result.review.findings.length} findings, ${state.files.length} files`;

    renderFindingList([
      ...result.inlineFindings.map((finding) => ({ ...finding, kind: "inline" })),
      ...result.skippedFindings.map((finding) => ({ ...finding, kind: "manual" })),
    ]);
    renderFileViewer(state.files);
    refreshFixPrompt();
    selectTab("files");

    elements.copyPromptButton.disabled = false;
    elements.postButton.disabled = false;
    setBusy(false, "Review ready");
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function postSelected() {
  if (!state.reviewId) {
    return;
  }

  setBusy(true, "Posting comments");

  try {
    const result = await requestJson(`/api/reviews/${state.reviewId}/post`, {
      method: "POST",
      body: {
        summary: elements.summary.value,
        inlineFindings: collectFindings("inline"),
        skippedFindings: collectFindings("manual"),
        githubToken: githubTokenOverride(),
      },
    });

    setBusy(
      false,
      `Posted ${result.inlineComments} comments and ${result.summaryComments} summary`,
    );
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function copyFixPrompt() {
  refreshFixPrompt();

  try {
    await navigator.clipboard.writeText(elements.promptPanel.textContent);
    elements.statusText.textContent = "Fix prompt copied";
  } catch {
    elements.statusText.textContent = "Select the fix prompt and copy it";
    selectTab("prompt");
  }
}

function renderProviders(providers) {
  elements.providerName.replaceChildren();
  elements.providerStrip.replaceChildren();

  for (const provider of providers) {
    const option = document.createElement("option");
    option.value = provider.name;
    option.textContent = provider.name;
    elements.providerName.append(option);

    const badge = document.createElement("span");
    badge.className = `provider-badge ${provider.type}`;
    badge.textContent = provider.name;
    elements.providerStrip.append(badge);
  }
}

function githubTokenOverride() {
  return elements.githubToken.value.trim();
}

function renderRepoPullRequests() {
  elements.repoPrList.replaceChildren();

  if (state.repoPullRequests.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No open PRs found.";
    elements.repoPrList.append(empty);
    return;
  }

  for (const pullRequest of state.repoPullRequests) {
    elements.repoPrList.append(createPullRequestRow(pullRequest));
  }
}

function createPullRequestRow(pullRequest) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `repo-pr ${pullRequest.reviewState}`;
  button.addEventListener("click", () => {
    selectPullRequest(pullRequest);
  });

  const title = document.createElement("strong");
  title.textContent = `#${pullRequest.number} ${pullRequest.title}`;

  const meta = document.createElement("span");
  meta.textContent = `${pullRequest.reviewState.replace("_", " ")} / ${pullRequest.author}`;

  button.append(title, meta);
  return button;
}

function renderGitState(result) {
  elements.gitPanel.className = "git-panel";
  elements.gitPanel.replaceChildren();
  elements.workspace.value = result.root || elements.workspace.value;

  const branch = document.createElement("strong");
  branch.textContent = result.branch ? `Branch ${result.branch}` : "Detached HEAD";

  const status = document.createElement("p");
  status.textContent = `${result.changedFiles} changed files / ${result.isDirty ? "dirty" : "clean"}`;

  elements.gitPanel.append(branch, status);

  if (result.github) {
    const github = document.createElement("p");
    github.textContent = `${result.github.base.fullName} via ${result.github.remotes
      .map((remote) => remote.name)
      .join(", ")}`;
    elements.gitPanel.append(github);
    elements.repoRef.value = result.github.base.fullName;
  }

  if (result.pullRequests.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = result.github
      ? "No open PR found for this branch."
      : "No GitHub remote detected.";
    elements.gitPanel.append(empty);
    return;
  }

  const candidates = document.createElement("div");
  candidates.className = "pr-candidates";

  for (const pullRequest of result.pullRequests) {
    candidates.append(createLocalPullRequestButton(pullRequest));
  }

  elements.gitPanel.append(candidates);

  if (result.pullRequests.length === 1) {
    selectPullRequest(result.pullRequests[0]);
  }
}

function renderGitError(message) {
  elements.gitPanel.className = "git-panel error";
  elements.gitPanel.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "Could not read git";

  const details = document.createElement("p");
  details.textContent = message;

  elements.gitPanel.append(title, details);
}

function createLocalPullRequestButton(pullRequest) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pr-candidate";
  button.textContent = `#${pullRequest.number} ${pullRequest.title}`;
  button.addEventListener("click", () => {
    selectPullRequest(pullRequest);
  });

  return button;
}

function selectPullRequest(pullRequest) {
  elements.prRef.value = pullRequest.htmlUrl;
  elements.prTitle.textContent = pullRequest.title;
  elements.statusText.textContent = `Selected PR #${pullRequest.number}`;
}

function renderFindingList(findings) {
  elements.commentsPanel.replaceChildren();

  if (findings.length === 0) {
    renderEmptyMessage(elements.commentsPanel, "No findings.");
    return;
  }

  for (const finding of findings) {
    const node = findingTemplate.content.firstElementChild.cloneNode(true);

    node.dataset.path = finding.path;
    node.dataset.line = String(finding.line);
    node.dataset.kind = finding.kind;
    node.dataset.severity = finding.severity;
    node.querySelector(".finding-location").textContent = `${finding.path}:${finding.line}`;
    const severity = node.querySelector(".finding-severity");
    severity.value = finding.severity;
    severity.addEventListener("change", () => {
      node.dataset.severity = severity.value;
      refreshFixPrompt();
    });
    node.querySelector(".finding-comment").value = finding.comment;
    node.querySelector(".finding-suggestion").value = finding.suggestion || "";
    elements.commentsPanel.append(node);
  }
}

function renderFileViewer(files) {
  elements.filesPanel.replaceChildren();
  state.selectedFileIndex = Math.min(state.selectedFileIndex, Math.max(files.length - 1, 0));

  if (files.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No changed files returned for this PR.";
    elements.filesPanel.append(empty);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "files-summary";
  const totals = files.reduce(
    (memo, file) => ({
      additions: memo.additions + (file.additions ?? 0),
      deletions: memo.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
  summary.textContent = `${files.length} files changed / +${totals.additions} -${totals.deletions}`;

  const layout = document.createElement("div");
  layout.className = "files-layout";

  const sidebar = document.createElement("aside");
  sidebar.className = "files-sidebar";
  sidebar.append(summary);

  const list = document.createElement("div");
  list.className = "file-list";
  files.forEach((file, index) => {
    list.append(createFileRow(file, index));
  });
  sidebar.append(list);

  const viewer = document.createElement("section");
  viewer.className = "file-diff-pane";
  viewer.append(createFileDiff(files[state.selectedFileIndex]));

  layout.append(sidebar, viewer);
  elements.filesPanel.append(layout);
}

function createFileRow(file, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `file-row ${file.status ?? "changed"}`;
  button.classList.toggle("active", index === state.selectedFileIndex);
  button.addEventListener("click", () => {
    state.selectedFileIndex = index;
    renderFileViewer(state.files);
  });

  const filename = document.createElement("strong");
  filename.textContent = file.filename;

  const meta = document.createElement("span");
  meta.textContent = `${file.status ?? "changed"} / +${file.additions ?? 0} -${file.deletions ?? 0}`;

  button.append(filename, meta);
  return button;
}

function createFileDiff(file) {
  const container = document.createElement("article");
  container.className = "file-diff";

  const header = document.createElement("div");
  header.className = "file-diff-header";

  const filename = document.createElement("strong");
  filename.textContent = file.filename;

  const meta = document.createElement("span");
  meta.textContent = `${file.status ?? "changed"} / +${file.additions ?? 0} -${file.deletions ?? 0}`;

  header.append(filename, meta);
  container.append(header);

  if (!file.patchAvailable || !file.patch) {
    const unavailable = document.createElement("p");
    unavailable.className = "file-patch-empty";
    unavailable.textContent = "Patch not available from GitHub for this file.";
    container.append(unavailable);
    return container;
  }

  const patch = document.createElement("pre");
  patch.className = "diff-view";

  file.patch.split("\n").forEach((line) => {
    const code = document.createElement("code");
    code.className = `diff-line ${diffLineClass(line)}`;
    code.textContent = line || " ";
    patch.append(code);
  });

  container.append(patch);
  return container;
}

function diffLineClass(line) {
  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "added";
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return "removed";
  }

  return "context";
}

function collectFindings(kind) {
  return [...elements.commentsPanel.querySelectorAll(".finding")]
    .filter((node) => node.dataset.kind === kind)
    .filter((node) => node.querySelector(".finding-selected").checked)
    .map((node) => ({
      path: node.dataset.path,
      line: Number(node.dataset.line),
      severity: node.querySelector(".finding-severity").value,
      comment: node.querySelector(".finding-comment").value,
      suggestion: node.querySelector(".finding-suggestion").value,
    }));
}

function refreshFixPrompt() {
  const findings = [...elements.commentsPanel.querySelectorAll(".finding")]
    .filter((node) => node.querySelector(".finding-selected").checked)
    .map((node) => ({
      path: node.dataset.path,
      line: node.dataset.line,
      severity: node.querySelector(".finding-severity").value,
      comment: node.querySelector(".finding-comment").value.trim(),
      suggestion: node.querySelector(".finding-suggestion").value.trim(),
    }));

  elements.promptPanel.textContent = buildFixPrompt(findings);
}

function buildFixPrompt(findings) {
  if (!state.pullRequest) {
    return "Run a review to generate a fix prompt.";
  }

  const lines = [
    `Fix the findings from this PR review: ${state.pullRequest.htmlUrl}`,
    "",
    elements.summary.value.trim(),
    "",
  ];

  findings.forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding.path}:${finding.line} [${finding.severity}]`);
    lines.push(finding.comment);
    if (finding.suggestion) {
      lines.push(`Suggested direction: ${finding.suggestion}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

function selectTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${name}Panel`);
  });
}

function clearResults() {
  state.files = [];
  state.reviewId = null;
  state.pullRequest = null;
  state.selectedFileIndex = 0;
  elements.postButton.disabled = true;
  elements.copyPromptButton.disabled = true;
  elements.summary.value = "";
  elements.summary.disabled = true;
  elements.prTitle.textContent = "No review loaded";
  elements.counts.textContent = "";
  elements.promptPanel.textContent = "Run a review to generate a fix prompt.";
  elements.commentsPanel.replaceChildren();
  renderEmptyMessage(elements.commentsPanel, "Run a review to see findings here.");
  elements.filesPanel.replaceChildren();
  renderEmptyMessage(elements.filesPanel, "Run a review to inspect changed files.");
}

function renderEmptyMessage(container, message) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  container.append(empty);
}

function setBusy(isBusy, message) {
  elements.runButton.disabled = isBusy;
  elements.loadRepoButton.disabled = isBusy;
  elements.readGitButton.disabled = isBusy;
  elements.copyPromptButton.disabled = isBusy || !state.reviewId;
  elements.postButton.disabled = isBusy || !state.reviewId;
  elements.saveGithubTokenButton.disabled =
    isBusy || !state.githubTokenStatus?.canPersistGithubToken;
  elements.clearGithubTokenButton.disabled =
    isBusy || !state.githubTokenStatus?.hasStoredGithubToken;
  elements.statusText.textContent = message;
  document.body.classList.toggle("busy", isBusy);
}

function isRepoRef(value) {
  const trimmed = value.trim();
  return Boolean(trimmed) && !trimmed.includes("/pull/") && !trimmed.includes("#");
}

async function requestJson(path, options = {}) {
  const headers = {};

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
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}
