declare global {
  interface Window {
    prAgent?: {
      getAuthToken(): Promise<string>;
      showWindow(): Promise<void>;
    };
  }
}

interface ProviderInfo {
  name: string;
  type: string;
}

interface GithubTokenStatus {
  envGithubToken: boolean;
  hasGithubToken: boolean;
  hasStoredGithubToken: boolean;
  canPersistGithubToken: boolean;
  reason: string;
}

interface ConfigResult {
  providers: ProviderInfo[];
  workspace: string;
  githubToken: GithubTokenStatus | null;
}

interface PullRequestLink {
  number: number;
  title: string;
  htmlUrl: string;
}

interface RepoPullRequest extends PullRequestLink {
  author: string;
  reviewState: string;
}

interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patchAvailable: boolean;
  patch: string;
}

interface Finding {
  path: string;
  line: number;
  severity: string;
  comment: string;
  suggestion?: string;
}

interface ReviewRunResult {
  reviewId: string;
  files: ChangedFile[];
  pullRequest: PullRequestLink;
  review: {
    summary: string;
    findings: unknown[];
    validationErrors?: string[];
  };
  inlineFindings: Finding[];
  skippedFindings: Finding[];
}

interface PostReviewResult {
  githubReviewId: number | null;
  inlineComments: number;
  summaryComments: number;
}

interface ReviewThread {
  threadId: string;
  isResolved: boolean;
  resolvedBy: string | null;
  path: string;
  line: number | null;
}

interface GitStateResult {
  root: string;
  branch: string;
  isDirty: boolean;
  changedFiles: number;
  github: {
    base: { fullName: string };
    remotes: { name: string }[];
  } | null;
  pullRequests: PullRequestLink[];
}

interface RepoPullsResult {
  repository: { fullName: string };
  pullRequests: RepoPullRequest[];
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

interface AppState {
  files: ChangedFile[];
  githubTokenStatus: GithubTokenStatus | null;
  reviewId: string | null;
  githubReviewId: number | null;
  pullRequest: PullRequestLink | null;
  repoPullRequests: RepoPullRequest[];
  selectedFileIndex: number;
  resolvedThreadIds: Set<string>;
  threadPollTimer: ReturnType<typeof setInterval> | null;
}

const state: AppState = {
  files: [],
  githubTokenStatus: null,
  reviewId: null,
  githubReviewId: null,
  pullRequest: null,
  repoPullRequests: [],
  selectedFileIndex: 0,
  resolvedThreadIds: new Set(),
  threadPollTimer: null,
};

const THREAD_POLL_INTERVAL_MS = 20 * 60 * 1000;

let authToken = "";

const elements = {
  commentsPanel: document.querySelector<HTMLDivElement>("#commentsPanel")!,
  clearGithubTokenButton: document.querySelector<HTMLButtonElement>(
    "#clearGithubTokenButton",
  )!,
  copyPromptButton:
    document.querySelector<HTMLButtonElement>("#copyPromptButton")!,
  counts: document.querySelector<HTMLDivElement>("#counts")!,
  filesPanel: document.querySelector<HTMLDivElement>("#filesPanel")!,
  gitPanel: document.querySelector<HTMLDivElement>("#gitPanel")!,
  githubToken: document.querySelector<HTMLInputElement>("#githubToken")!,
  githubTokenStatus:
    document.querySelector<HTMLDivElement>("#githubTokenStatus")!,
  loadRepoButton: document.querySelector<HTMLButtonElement>("#loadRepoButton")!,
  postButton: document.querySelector<HTMLButtonElement>("#postButton")!,
  providerName: document.querySelector<HTMLSelectElement>("#providerName")!,
  providerStrip: document.querySelector<HTMLDivElement>("#providerStrip")!,
  promptPanel: document.querySelector<HTMLPreElement>("#promptPanel")!,
  prRef: document.querySelector<HTMLInputElement>("#prRef")!,
  prTitle: document.querySelector<HTMLElement>("#prTitle")!,
  repoMeta: document.querySelector<HTMLDivElement>("#repoMeta")!,
  repoPrList: document.querySelector<HTMLDivElement>("#repoPrList")!,
  repoRef: document.querySelector<HTMLInputElement>("#repoRef")!,
  readGitButton: document.querySelector<HTMLButtonElement>("#readGitButton")!,
  reviewForm: document.querySelector<HTMLFormElement>("#reviewForm")!,
  runButton: document.querySelector<HTMLButtonElement>("#runButton")!,
  saveGithubTokenButton: document.querySelector<HTMLButtonElement>(
    "#saveGithubTokenButton",
  )!,
  statusText: document.querySelector<HTMLParagraphElement>("#statusText")!,
  summary: document.querySelector<HTMLTextAreaElement>("#summary")!,
  workspace: document.querySelector<HTMLInputElement>("#workspace")!,
};

const findingTemplate =
  document.querySelector<HTMLTemplateElement>("#findingTemplate")!;

init();

async function init() {
  bindEvents();
  setBusy(true, "Loading");

  try {
    authToken = await resolveAuthToken();
    const config = await requestJson<ConfigResult>("/api/config");
    renderProviders(config.providers);
    elements.workspace.value = config.workspace;
    renderGithubTokenStatus(config.githubToken);
    setBusy(false, "Ready");
  } catch (error) {
    setBusy(false, (error as Error).message);
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

  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
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
    const status = await requestJson<GithubTokenStatus>("/api/github-token", {
      method: "PUT",
      body: {
        githubToken,
      },
    });

    elements.githubToken.value = "";
    renderGithubTokenStatus(status);
    setBusy(false, "Token saved");
  } catch (error) {
    setBusy(false, (error as Error).message);
  }
}

async function clearGithubToken() {
  setBusy(true, "Forgetting token");

  try {
    const status = await requestJson<GithubTokenStatus>("/api/github-token", {
      method: "DELETE",
    });

    elements.githubToken.value = "";
    renderGithubTokenStatus(status);
    setBusy(false, "Token forgotten");
  } catch (error) {
    setBusy(false, (error as Error).message);
  }
}

function renderGithubTokenStatus(status: GithubTokenStatus | null) {
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
  elements.githubToken.placeholder = status.hasGithubToken
    ? "token available"
    : "optional";

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
    const result = await requestJson<GitStateResult>("/api/git", {
      method: "POST",
      body: {
        workspace,
        githubToken: githubTokenOverride(),
      },
    });

    renderGitState(result);
    setBusy(
      false,
      result.pullRequests.length > 0 ? "Local PR found" : "Git read",
    );
  } catch (error) {
    renderGitError((error as Error).message);
    setBusy(false, (error as Error).message);
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
    const result = await requestJson<RepoPullsResult>("/api/github/pulls", {
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
    setBusy(false, (error as Error).message);
    elements.repoMeta.textContent = (error as Error).message;
  }
}

async function runReview() {
  clearResults();
  setBusy(true, "Running review");

  try {
    const result = await requestJson<ReviewRunResult>("/api/reviews", {
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
      ...result.inlineFindings.map((finding) => ({
        ...finding,
        kind: "inline",
      })),
      ...result.skippedFindings.map((finding) => ({
        ...finding,
        kind: "manual",
      })),
    ]);
    renderFileViewer(state.files);
    refreshFixPrompt();
    selectTab("files");

    elements.copyPromptButton.disabled = false;
    elements.postButton.disabled = false;
    setBusy(false, "Review ready");
  } catch (error) {
    setBusy(false, (error as Error).message);
  }
}

async function postSelected() {
  if (!state.reviewId) {
    return;
  }

  setBusy(true, "Posting comments");

  try {
    const result = await requestJson<PostReviewResult>(
      `/api/reviews/${state.reviewId}/post`,
      {
        method: "POST",
        body: {
          summary: elements.summary.value,
          inlineFindings: collectFindings("inline"),
          skippedFindings: collectFindings("manual"),
          githubToken: githubTokenOverride(),
        },
      },
    );

    setBusy(
      false,
      `Posted ${result.inlineComments} comments and ${result.summaryComments} summary`,
    );

    state.githubReviewId = result.githubReviewId ?? null;
    if (state.githubReviewId) {
      startThreadPolling();
    }
  } catch (error) {
    setBusy(false, (error as Error).message);
  }
}

function startThreadPolling() {
  stopThreadPolling();
  state.resolvedThreadIds = new Set();

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  state.threadPollTimer = setInterval(
    pollReviewThreads,
    THREAD_POLL_INTERVAL_MS,
  );
  pollReviewThreads();
}

function stopThreadPolling() {
  if (state.threadPollTimer) {
    clearInterval(state.threadPollTimer);
    state.threadPollTimer = null;
  }
}

async function pollReviewThreads() {
  if (!state.githubReviewId || !state.pullRequest) {
    stopThreadPolling();
    return;
  }

  let threads: ReviewThread[];
  try {
    const result = await requestJson<{ threads: ReviewThread[] }>(
      "/api/review-threads",
      {
        method: "POST",
        body: {
          prRef: state.pullRequest.htmlUrl,
          reviewId: state.githubReviewId,
          githubToken: githubTokenOverride(),
        },
      },
    );
    threads = result.threads;
  } catch {
    return;
  }

  for (const thread of threads) {
    if (!thread.isResolved || state.resolvedThreadIds.has(thread.threadId)) {
      continue;
    }

    state.resolvedThreadIds.add(thread.threadId);
    markFindingResolved(thread);
    notifyThreadResolved(thread);
  }

  if (threads.length > 0 && threads.every((thread) => thread.isResolved)) {
    stopThreadPolling();
  }
}

function markFindingResolved(thread: ReviewThread) {
  const nodes = elements.commentsPanel.querySelectorAll(
    `.finding[data-path="${CSS.escape(thread.path)}"][data-line="${CSS.escape(String(thread.line))}"]`,
  );

  for (const node of nodes) {
    node.classList.add("resolved");
    const badge = node.querySelector<HTMLElement>(".finding-resolved")!;
    badge.textContent = thread.resolvedBy
      ? `Resolved by ${thread.resolvedBy}`
      : "Resolved";
    badge.hidden = false;
  }
}

function notifyThreadResolved(thread: ReviewThread) {
  const message = thread.resolvedBy
    ? `${thread.path}:${thread.line} resolved by ${thread.resolvedBy}`
    : `${thread.path}:${thread.line} resolved`;

  elements.statusText.textContent = message;

  if ("Notification" in window && Notification.permission === "granted") {
    const notification = new Notification("Review comment resolved", {
      body: message,
    });
    notification.onclick = () => {
      window.prAgent?.showWindow?.();
    };
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

function renderProviders(providers: ProviderInfo[]) {
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

function createPullRequestRow(pullRequest: RepoPullRequest) {
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

function renderGitState(result: GitStateResult) {
  elements.gitPanel.className = "git-panel";
  elements.gitPanel.replaceChildren();
  elements.workspace.value = result.root || elements.workspace.value;

  const branch = document.createElement("strong");
  branch.textContent = result.branch
    ? `Branch ${result.branch}`
    : "Detached HEAD";

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

function renderGitError(message: string) {
  elements.gitPanel.className = "git-panel error";
  elements.gitPanel.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "Could not read git";

  const details = document.createElement("p");
  details.textContent = message;

  elements.gitPanel.append(title, details);
}

function createLocalPullRequestButton(pullRequest: PullRequestLink) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pr-candidate";
  button.textContent = `#${pullRequest.number} ${pullRequest.title}`;
  button.addEventListener("click", () => {
    selectPullRequest(pullRequest);
  });

  return button;
}

function selectPullRequest(pullRequest: PullRequestLink) {
  elements.prRef.value = pullRequest.htmlUrl;
  elements.prTitle.textContent = pullRequest.title;
  elements.statusText.textContent = `Selected PR #${pullRequest.number}`;
}

function renderFindingList(findings: (Finding & { kind: string })[]) {
  elements.commentsPanel.replaceChildren();

  if (findings.length === 0) {
    renderEmptyMessage(elements.commentsPanel, "No findings.");
    return;
  }

  for (const finding of findings) {
    const node = findingTemplate.content.firstElementChild!.cloneNode(
      true,
    ) as HTMLElement;

    node.dataset.path = finding.path;
    node.dataset.line = String(finding.line);
    node.dataset.kind = finding.kind;
    node.dataset.severity = finding.severity;
    node.querySelector(".finding-location")!.textContent =
      `${finding.path}:${finding.line}`;
    const severity =
      node.querySelector<HTMLSelectElement>(".finding-severity")!;
    severity.value = finding.severity;
    severity.addEventListener("change", () => {
      node.dataset.severity = severity.value;
      refreshFixPrompt();
    });
    node.querySelector<HTMLTextAreaElement>(".finding-comment")!.value =
      finding.comment;
    node.querySelector<HTMLTextAreaElement>(".finding-suggestion")!.value =
      finding.suggestion || "";
    elements.commentsPanel.append(node);
  }
}

function renderFileViewer(files: ChangedFile[]) {
  elements.filesPanel.replaceChildren();
  state.selectedFileIndex = Math.min(
    state.selectedFileIndex,
    Math.max(files.length - 1, 0),
  );

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

function createFileRow(file: ChangedFile, index: number) {
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

function createFileDiff(file: ChangedFile) {
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

function diffLineClass(line: string) {
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

function collectFindings(kind: string) {
  return [...elements.commentsPanel.querySelectorAll<HTMLElement>(".finding")]
    .filter((node) => node.dataset.kind === kind)
    .filter(
      (node) =>
        node.querySelector<HTMLInputElement>(".finding-selected")!.checked,
    )
    .map((node) => ({
      path: node.dataset.path,
      line: Number(node.dataset.line),
      severity:
        node.querySelector<HTMLSelectElement>(".finding-severity")!.value,
      comment:
        node.querySelector<HTMLTextAreaElement>(".finding-comment")!.value,
      suggestion: node.querySelector<HTMLTextAreaElement>(
        ".finding-suggestion",
      )!.value,
    }));
}

function refreshFixPrompt() {
  const findings = [
    ...elements.commentsPanel.querySelectorAll<HTMLElement>(".finding"),
  ]
    .filter(
      (node) =>
        node.querySelector<HTMLInputElement>(".finding-selected")!.checked,
    )
    .map((node) => ({
      path: node.dataset.path,
      line: node.dataset.line,
      severity:
        node.querySelector<HTMLSelectElement>(".finding-severity")!.value,
      comment: node
        .querySelector<HTMLTextAreaElement>(".finding-comment")!
        .value.trim(),
      suggestion: node
        .querySelector<HTMLTextAreaElement>(".finding-suggestion")!
        .value.trim(),
    }));

  elements.promptPanel.textContent = buildFixPrompt(findings);
}

function buildFixPrompt(
  findings: {
    path?: string;
    line?: string | number;
    severity: string;
    comment: string;
    suggestion: string;
  }[],
) {
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
    lines.push(
      `${index + 1}. ${finding.path}:${finding.line} [${finding.severity}]`,
    );
    lines.push(finding.comment);
    if (finding.suggestion) {
      lines.push(`Suggested direction: ${finding.suggestion}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

function selectTab(name: string | undefined) {
  document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${name}Panel`);
  });
}

function clearResults() {
  stopThreadPolling();
  state.resolvedThreadIds = new Set();
  state.files = [];
  state.reviewId = null;
  state.githubReviewId = null;
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
  renderEmptyMessage(
    elements.commentsPanel,
    "Run a review to see findings here.",
  );
  elements.filesPanel.replaceChildren();
  renderEmptyMessage(
    elements.filesPanel,
    "Run a review to inspect changed files.",
  );
}

function renderEmptyMessage(container: HTMLElement, message: string) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  container.append(empty);
}

function setBusy(isBusy: boolean, message: string) {
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

function isRepoRef(value: string) {
  const trimmed = value.trim();
  return (
    Boolean(trimmed) && !trimmed.includes("/pull/") && !trimmed.includes("#")
  );
}

async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};

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
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}
