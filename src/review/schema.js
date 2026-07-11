const SEVERITIES = new Set([
  "bug",
  "security",
  "performance",
  "maintainability",
  "test",
  "question",
]);

export function normalizeFinding(finding) {
  if (!finding || typeof finding !== "object") {
    return null;
  }

  const path = stringValue(finding.path);
  const line = Number(finding.line);
  const severity = stringValue(finding.severity).toLowerCase();
  const comment = stringValue(finding.comment);

  if (
    !path ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !SEVERITIES.has(severity) ||
    !comment
  ) {
    return null;
  }

  return {
    path,
    line,
    severity,
    comment,
    suggestion: stringValue(finding.suggestion),
  };
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
