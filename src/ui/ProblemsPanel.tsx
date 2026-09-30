import type { Problem } from "../graph/validate";
import { t } from "../i18n";

interface ProblemsPanelProps {
  problems: readonly Problem[];
  /** Problems from loading the file (no node to point at). */
  loadWarnings: readonly string[];
  onShow: (problem: Problem) => void;
  onClose: () => void;
}

/** The results of the graph checks, docked left of the canvas; clicking a row goes to its node. */
export function ProblemsPanel({ problems, loadWarnings, onShow, onClose }: ProblemsPanelProps) {
  const rows: Problem[] = [...problems, ...loadWarnings.map((message) => ({ severity: "warning" as const, message }))];
  const errors = rows.filter((row) => row.severity === "error").length;
  return (
    <aside className="problems-panel" onKeyDown={(event) => event.key === "Escape" && onClose()}>
      <div className="problems-header">
        <span>
          {t("Problems")} <span className="problems-count">{summary(errors, rows.length - errors)}</span>
        </span>
        <button className="problems-close" onClick={onClose} title={t("Close")} aria-label={t("Close")}>
          ×
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="problems-empty">{t("✓ No problems found.")}</div>
      ) : (
        <div className="problems-list">
          {rows.map((problem, index) => (
            <div
              key={index}
              className={`problems-row ${problem.severity}${problem.viewId ?? problem.nodeId ? " linked" : ""}`}
              onClick={() => onShow(problem)}
              title={problem.viewId ?? problem.nodeId ? t("Show the node") : undefined}
            >
              <span className="problems-icon">{problem.severity === "error" ? "✕" : "⚠"}</span>
              <span>{problem.message}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export function summary(errors: number, warnings: number): string {
  const parts = [errors > 0 && t("{count} error(s)", { count: errors }), warnings > 0 && t("{count} warning(s)", { count: warnings })];
  return parts.filter(Boolean).join(", ") || t("none");
}
