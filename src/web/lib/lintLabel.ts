const LABELS: [RegExp, string][] = [
  [/^verdict\.summary$/, "Summary"],
  [/^strengths\[\d+\]$/, "A strength"],
  [/^gaps\[\d+\]\.whyItMatters$/, "A gap, why it matters"],
  [/^gaps\[\d+\]\.whatGoodLooksLike$/, "A gap, what good looks like"],
  [/^steps\[\d+\]\.took\[\d+\]\.point$/, "A step, what held"],
  [/^steps\[\d+\]\.missing\[\d+\]$/, "A step, what is missing"],
];

/** One writing check as a reader sees it. A field with no known label shows the issue alone, never the stored name. */
export function lintText(issue: { field: string; issue: string }): string {
  const label = LABELS.find(([pattern]) => pattern.test(issue.field))?.[1];
  return label ? `${label}: ${issue.issue}` : issue.issue;
}
