declare global {
  interface Window {
    prAgent?: {
      getAuthToken(): Promise<string>;
      showWindow(): Promise<void>;
    };
  }
}

export interface ProviderInfo {
  name: string;
  type: string;
}

export interface GithubTokenStatus {
  envGithubToken: boolean;
  hasGithubToken: boolean;
  hasStoredGithubToken: boolean;
  canPersistGithubToken: boolean;
  reason: string;
}

export interface ConfigResult {
  providers: ProviderInfo[];
  workspace: string;
  githubToken: GithubTokenStatus | null;
}

export interface PullRequestLink {
  number: number;
  title: string;
  htmlUrl: string;
}

export interface RepoPullRequest extends PullRequestLink {
  author: string;
  reviewState: string;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patchAvailable: boolean;
  patch: string;
}

export interface Finding {
  path: string;
  line: number;
  severity: string;
  comment: string;
  suggestion?: string;
}

export interface ReviewRunResult {
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

export interface PostReviewResult {
  githubReviewId: number | null;
  inlineComments: number;
  summaryComments: number;
}

export interface ReviewThread {
  threadId: string;
  isResolved: boolean;
  resolvedBy: string | null;
  path: string;
  line: number | null;
}

export interface GitStateResult {
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

export interface RepoPullsResult {
  repository: { fullName: string };
  pullRequests: RepoPullRequest[];
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
}

export type FindingKind = "inline" | "manual";

export interface EditableFinding extends Finding {
  id: string;
  kind: FindingKind;
  suggestion: string;
  selected: boolean;
}
