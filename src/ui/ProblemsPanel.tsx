import type { Problem } from "../graph/validate";

interface ProblemsPanelProps {
  problems: readonly Problem[];
  /** Problems from loading the file (no node to point at). */
  loadWarnings: readonly string[];
  onShow: (problem: Problem) => void;
  onClose: () => void;
}

/** The results of the graph checks; clicking a row goes to its node. */
export function ProblemsPanel({ problems, loadWarnings, onShow, onClose }: ProblemsPanelProps) {
  const rows: Problem[] = [...problems, ...loadWarnings.map((message) => ({ severity: "warning" as const, message }))];
  const errors = rows.filter((row) => row.severity === "error").length;
  return (
    <div className="problems-panel" onKeyDown={(event) => event.key === "Escape" && onClose()}>
      <div className="problems-header">
        <span>
          Problems <span className="problems-count">{summary(errors, rows.length - errors)}</span>
        </span>
        <button className="problems-close" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="problems-empty">✓ No problems found.</div>
      ) : (
        <div className="problems-list">
          {rows.map((problem, index) => (
            <div
              key={index}
              className={`problems-row ${problem.severity}${problem.viewId ?? problem.nodeId ? " linked" : ""}`}
              onClick={() => onShow(problem)}
              title={problem.viewId ?? problem.nodeId ? "Show the node" : undefined}
            >
              <span className="problems-icon">{problem.severity === "error" ? "✕" : "⚠"}</span>
              <span>{problem.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function summary(errors: number, warnings: number): string {
  const parts = [errors > 0 && `${errors} error${errors === 1 ? "" : "s"}`, warnings > 0 && `${warnings} warning${warnings === 1 ? "" : "s"}`];
  return parts.filter(Boolean).join(", ") || "none";
}
