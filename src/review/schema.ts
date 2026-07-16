export type Severity =
  "bug" | "security" | "performance" | "maintainability" | "test" | "question";

export interface Finding {
  path: string;
  line: number;
  severity: Severity;
  comment: string;
  suggestion?: string;
}

export const SEVERITIES = new Set<string>([
  "bug",
  "security",
  "performance",
  "maintainability",
  "test",
  "question",
]);

export function normalizeFinding(finding: unknown): Finding | null {
  if (!finding || typeof finding !== "object") {
    return null;
  }

  const raw = finding as Record<string, unknown>;
  const path = stringValue(raw.path);
  const line = Number(raw.line);
  const severity = stringValue(raw.severity).toLowerCase();
  const comment = stringValue(raw.comment);

  if (
    !path ||
    !Number.isInteger(line) ||
    line < 1 ||
    !SEVERITIES.has(severity) ||
    !comment
  ) {
    return null;
  }

  return {
    path,
    line,
    severity: severity as Severity,
    comment,
    suggestion: stringValue(raw.suggestion),
  };
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
