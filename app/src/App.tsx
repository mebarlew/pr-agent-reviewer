import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { initAuthToken, requestJson } from "./api";
import { buildFixPrompt } from "./fixPrompt";
import type {
  ConfigResult,
  EditableFinding,
  Finding,
  FindingKind,
  GitStateResult,
  GithubTokenStatus,
  PostReviewResult,
  ProviderInfo,
  PullRequestLink,
  RepoPullRequest,
  RepoPullsResult,
  ReviewRunResult,
  ReviewThread,
} from "./types";
import { FindingsDock } from "./components/FindingsDock";
import { ReviewForm } from "./components/ReviewForm";
import type { GitPanelView } from "./components/GitPanel";
import { ReviewSurface } from "./components/ReviewSurface";
import type { TabName } from "./components/TabBar";
import { TopBar } from "./components/TopBar";

const THREAD_POLL_INTERVAL_MS = 20 * 60 * 1000;

interface ReviewState {
  reviewId: string;
  pullRequest: PullRequestLink;
  files: ReviewRunResult["files"];
  findingsCount: number;
  invalidCount: number;
}

interface PollTarget {
  githubReviewId: number;
  prRef: string;
  startedAt: number;
}

export function App() {
  const [busy, setBusy] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Loading");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [githubTokenStatus, setGithubTokenStatus] =
    useState<GithubTokenStatus | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(
    "Token not checked",
  );

  const [prRef, setPrRef] = useState("");
  const [providerName, setProviderName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [repoRef, setRepoRef] = useState("");

  const [gitPanel, setGitPanel] = useState<GitPanelView>({ kind: "initial" });
  const [repoMeta, setRepoMeta] = useState("Paste a PR link or browse a repo.");
  const [repoPullRequests, setRepoPullRequests] = useState<
    RepoPullRequest[] | null
  >(null);

  const [prTitle, setPrTitle] = useState("No review loaded");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [findings, setFindings] = useState<EditableFinding[] | null>(null);
  const [summary, setSummary] = useState("");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabName>("files");

  const [pollTarget, setPollTarget] = useState<PollTarget | null>(null);
  const [resolvedThreads, setResolvedThreads] = useState<
    Map<string, string | null>
  >(new Map());

  // The thread poller reads the latest token override without restarting the
  // polling session when the input changes, matching the vanilla app.
  const githubTokenRef = useRef(githubToken);
  useEffect(() => {
    githubTokenRef.current = githubToken;
  }, [githubToken]);

  function setBusyStatus(isBusy: boolean, message: string): void {
    setBusy(isBusy);
    setStatusMessage(message);
  }

  useEffect(() => {
    document.body.classList.toggle("busy", busy);
  }, [busy]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initAuthToken();
        const config = await requestJson<ConfigResult>("/api/config");
        if (cancelled) {
          return;
        }

        setProviders(config.providers);
        setProviderName(config.providers[0]?.name ?? "");
        setWorkspace(config.workspace);
        applyGithubTokenStatus(config.githubToken);
        setBusyStatus(false, "Ready");
      } catch (error) {
        if (!cancelled) {
          setBusyStatus(false, (error as Error).message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pollTarget) {
      return;
    }

    const target = pollTarget;

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const notifiedThreadIds = new Set<string>();
    let active = true;

    async function poll(): Promise<void> {
      let threads: ReviewThread[];
      try {
        const result = await requestJson<{ threads: ReviewThread[] }>(
          "/api/review-threads",
          {
            method: "POST",
            body: {
              prRef: target.prRef,
              reviewId: target.githubReviewId,
              githubToken: githubTokenRef.current.trim(),
            },
          },
        );
        threads = result.threads;
      } catch {
        return;
      }

      if (!active) {
        return;
      }

      for (const thread of threads) {
        if (!thread.isResolved || notifiedThreadIds.has(thread.threadId)) {
          continue;
        }

        notifiedThreadIds.add(thread.threadId);
        setResolvedThreads((previous) =>
          new Map(previous).set(
            `${thread.path}:${thread.line}`,
            thread.resolvedBy,
          ),
        );
        notifyThreadResolved(thread);
      }

      if (threads.length > 0 && threads.every((thread) => thread.isResolved)) {
        clearInterval(timer);
      }
    }

    const timer = setInterval(poll, THREAD_POLL_INTERVAL_MS);
    poll();

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pollTarget]);

  function notifyThreadResolved(thread: ReviewThread): void {
    const message = thread.resolvedBy
      ? `${thread.path}:${thread.line} resolved by ${thread.resolvedBy}`
      : `${thread.path}:${thread.line} resolved`;

    setStatusMessage(message);

    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification("Review comment resolved", {
        body: message,
      });
      notification.onclick = () => {
        window.prAgent?.showWindow?.();
      };
    }
  }

  function applyGithubTokenStatus(status: GithubTokenStatus | null): void {
    setGithubTokenStatus(status ?? null);
    setTokenNotice(null);
  }

  function githubTokenOverride(): string {
    return githubToken.trim();
  }

  function clearResults(): void {
    setPollTarget(null);
    setResolvedThreads(new Map());
    setReview(null);
    setFindings(null);
    setSummary("");
    setSelectedFileIndex(0);
    setPrTitle("No review loaded");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (isRepoRef(prRef)) {
      setRepoRef(prRef);
      await loadRepositoryPullRequests(prRef);
      return;
    }

    await runReview();
  }

  async function runReview(): Promise<void> {
    clearResults();
    setBusyStatus(true, "Running review");

    try {
      const result = await requestJson<ReviewRunResult>("/api/reviews", {
        method: "POST",
        body: {
          prRef,
          providerName,
          workspace,
          githubToken: githubTokenOverride(),
        },
      });

      setReview({
        reviewId: result.reviewId,
        pullRequest: result.pullRequest,
        files: Array.isArray(result.files) ? result.files : [],
        findingsCount: result.review.findings.length,
        invalidCount: result.review.validationErrors?.length ?? 0,
      });
      setSelectedFileIndex(0);
      setPrTitle(result.pullRequest.title);
      setSummary(result.review.summary);
      setFindings([
        ...result.inlineFindings.map((finding, index) =>
          toEditableFinding(finding, "inline", index),
        ),
        ...result.skippedFindings.map((finding, index) =>
          toEditableFinding(finding, "manual", index),
        ),
      ]);
      setActiveTab("files");
      setBusyStatus(false, "Review ready");
    } catch (error) {
      setBusyStatus(false, (error as Error).message);
    }
  }

  async function loadRepositoryPullRequests(
    submittedRef?: string,
  ): Promise<void> {
    const ref = (submittedRef || repoRef || prRef).trim();
    if (!ref) {
      setRepoMeta("Enter a repo or PR link.");
      return;
    }

    setBusyStatus(true, "Loading PRs");
    setRepoPullRequests(null);

    try {
      const result = await requestJson<RepoPullsResult>("/api/github/pulls", {
        method: "POST",
        body: {
          repoRef: ref,
          githubToken: githubTokenOverride(),
        },
      });

      setRepoPullRequests(result.pullRequests);
      setRepoRef(result.repository.fullName);
      setRepoMeta(
        `${result.repository.fullName} / ${result.pullRequests.length} open PRs`,
      );
      setBusyStatus(false, "Choose a PR");
    } catch (error) {
      setBusyStatus(false, (error as Error).message);
      setRepoMeta((error as Error).message);
    }
  }

  async function readGitWorkspace(): Promise<void> {
    const workspacePath = workspace.trim();
    if (!workspacePath) {
      setGitPanel({ kind: "error", message: "Enter a workspace path." });
      return;
    }

    setBusyStatus(true, "Reading git");

    try {
      const result = await requestJson<GitStateResult>("/api/git", {
        method: "POST",
        body: {
          workspace: workspacePath,
          githubToken: githubTokenOverride(),
        },
      });

      setGitPanel({ kind: "loaded", result });
      setWorkspace(result.root || workspace);
      if (result.github) {
        setRepoRef(result.github.base.fullName);
      }
      if (result.pullRequests.length === 1) {
        selectPullRequest(result.pullRequests[0]);
      }
      setBusyStatus(
        false,
        result.pullRequests.length > 0 ? "Local PR found" : "Git read",
      );
    } catch (error) {
      setGitPanel({ kind: "error", message: (error as Error).message });
      setBusyStatus(false, (error as Error).message);
    }
  }

  async function saveGithubToken(): Promise<void> {
    const token = githubToken.trim();
    if (!token) {
      setTokenNotice("Enter a token to save.");
      return;
    }

    setBusyStatus(true, "Saving token");

    try {
      const status = await requestJson<GithubTokenStatus>("/api/github-token", {
        method: "PUT",
        body: {
          githubToken: token,
        },
      });

      setGithubToken("");
      applyGithubTokenStatus(status);
      setBusyStatus(false, "Token saved");
    } catch (error) {
      setBusyStatus(false, (error as Error).message);
    }
  }

  async function clearGithubToken(): Promise<void> {
    setBusyStatus(true, "Forgetting token");

    try {
      const status = await requestJson<GithubTokenStatus>("/api/github-token", {
        method: "DELETE",
      });

      setGithubToken("");
      applyGithubTokenStatus(status);
      setBusyStatus(false, "Token forgotten");
    } catch (error) {
      setBusyStatus(false, (error as Error).message);
    }
  }

  async function postSelected(): Promise<void> {
    if (!review) {
      return;
    }

    setBusyStatus(true, "Posting comments");

    try {
      const result = await requestJson<PostReviewResult>(
        `/api/reviews/${review.reviewId}/post`,
        {
          method: "POST",
          body: {
            summary,
            inlineFindings: collectFindings("inline"),
            skippedFindings: collectFindings("manual"),
            githubToken: githubTokenOverride(),
          },
        },
      );

      setBusyStatus(
        false,
        `Posted ${result.inlineComments} comments and ${result.summaryComments} summary`,
      );

      if (result.githubReviewId) {
        setPollTarget({
          githubReviewId: result.githubReviewId,
          prRef: review.pullRequest.htmlUrl,
          startedAt: Date.now(),
        });
      } else {
        setPollTarget(null);
      }
    } catch (error) {
      setBusyStatus(false, (error as Error).message);
    }
  }

  function collectFindings(kind: FindingKind): Finding[] {
    return (findings ?? [])
      .filter((finding) => finding.kind === kind && finding.selected)
      .map((finding) => ({
        path: finding.path,
        line: finding.line,
        severity: finding.severity,
        comment: finding.comment,
        suggestion: finding.suggestion,
      }));
  }

  async function copyFixPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fixPrompt);
      setStatusMessage("Fix prompt copied");
    } catch {
      setStatusMessage("Select the fix prompt and copy it");
      setActiveTab("prompt");
    }
  }

  function selectPullRequest(pullRequest: PullRequestLink): void {
    setPrRef(pullRequest.htmlUrl);
    setPrTitle(pullRequest.title);
    setStatusMessage(`Selected PR #${pullRequest.number}`);
  }

  function updateFinding(id: string, patch: Partial<EditableFinding>): void {
    setFindings(
      (previous) =>
        previous?.map((finding) =>
          finding.id === id ? { ...finding, ...patch } : finding,
        ) ?? null,
    );
  }

  const selectedFindings = (findings ?? []).filter(
    (finding) => finding.selected,
  );
  const fixPrompt = buildFixPrompt(
    review?.pullRequest ?? null,
    summary,
    selectedFindings,
  );
  const counts = review
    ? review.invalidCount
      ? `${review.findingsCount} findings, ${review.files.length} files, ${review.invalidCount} invalid`
      : `${review.findingsCount} findings, ${review.files.length} files`
    : "";

  return (
    <main className="shell">
      <TopBar statusMessage={statusMessage} providers={providers} />

      <section className="workspace" aria-label="Review workspace">
        <ReviewForm
          busy={busy}
          prRef={prRef}
          providerName={providerName}
          providers={providers}
          workspace={workspace}
          gitPanel={gitPanel}
          githubToken={githubToken}
          githubTokenStatus={githubTokenStatus}
          tokenNotice={tokenNotice}
          repoRef={repoRef}
          repoMeta={repoMeta}
          repoPullRequests={repoPullRequests}
          onPrRefChange={setPrRef}
          onProviderNameChange={setProviderName}
          onWorkspaceChange={setWorkspace}
          onGithubTokenChange={setGithubToken}
          onRepoRefChange={setRepoRef}
          onSubmit={handleSubmit}
          onReadGit={readGitWorkspace}
          onSaveGithubToken={saveGithubToken}
          onClearGithubToken={clearGithubToken}
          onLoadRepo={() => loadRepositoryPullRequests()}
          onSelectPullRequest={selectPullRequest}
        />

        <ReviewSurface
          prTitle={prTitle}
          counts={counts}
          activeTab={activeTab}
          files={review ? review.files : null}
          selectedFileIndex={selectedFileIndex}
          fixPrompt={fixPrompt}
          onSelectTab={setActiveTab}
          onSelectFile={setSelectedFileIndex}
        />

        <FindingsDock
          summary={summary}
          summaryEnabled={review !== null}
          findings={findings}
          resolvedThreads={resolvedThreads}
          copyDisabled={busy || !review}
          postDisabled={busy || !review}
          onSummaryChange={setSummary}
          onFindingChange={updateFinding}
          onCopyPrompt={copyFixPrompt}
          onPost={postSelected}
        />
      </section>
    </main>
  );
}

function toEditableFinding(
  finding: Finding,
  kind: FindingKind,
  index: number,
): EditableFinding {
  return {
    ...finding,
    id: `${kind}-${index}`,
    kind,
    suggestion: finding.suggestion || "",
    selected: true,
  };
}

function isRepoRef(value: string): boolean {
  const trimmed = value.trim();
  return (
    Boolean(trimmed) && !trimmed.includes("/pull/") && !trimmed.includes("#")
  );
}
