import { useEffect, useRef } from "react";
import type { PasteMode, PasteModeQuestion } from "../app/editor";

interface PasteModeDialogProps {
  question: PasteModeQuestion;
  onAnswer: (mode: PasteMode | null) => void;
}

const CHOICES: { mode: PasteMode; label: string; key: string; hint: string }[] = [
  {
    mode: "copy",
    label: "Copy",
    key: "C",
    hint: "New nodes with new names. Their texts are copied under the new names (keys) and from then on are edited separately.",
  },
  {
    mode: "link",
    label: "Link",
    key: "L",
    hint:
      "Linked copies: the same nodes shown in another place — same data, name, texts and id, so editing one changes all of them " +
      "and a choice made through any copy is the same choice. Connections are not shared: each copy has its own.",
  },
];

/** Asks whether pasted nodes with unique names become new nodes or linked copies of their originals. */
export function PasteModeDialog({ question, onAnswer }: PasteModeDialogProps) {
  const copyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => copyRef.current?.focus(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      // Physical keys, so C / L also work with another layout.
      const code = event.code;
      let answer: PasteMode | null | undefined;
      if (key === "escape") answer = null;
      else if (code === "KeyC" && !event.ctrlKey && !event.metaKey) answer = "copy";
      else if (code === "KeyL" && !event.ctrlKey && !event.metaKey) answer = "link";
      if (answer === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onAnswer(answer);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onAnswer]);

  const nodes = question.count === 1 ? "1 node" : `${question.count} nodes`;
  return (
    <div className="dialog-backdrop" onPointerDown={() => onAnswer(null)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="paste-mode-title" onPointerDown={(event) => event.stopPropagation()}>
        <h2 id="paste-mode-title">Copy or link?</h2>
        <p>
          {nodes} ({question.types.join(", ")}) {question.count === 1 ? "has a unique name" : "have unique names"} — a name is the
          key of the node's texts.{" "}
          {question.count === 1
            ? "Paste it as a new node, or as a linked copy of the original?"
            : "Paste them as new nodes, or as linked copies of the originals?"}
        </p>
        <div className="dialog-actions">
          {CHOICES.map((choice) => (
            <div key={choice.mode} className="dialog-choice">
              <button
                ref={choice.mode === "copy" ? copyRef : undefined}
                className={`dialog-button${choice.mode === "copy" ? " primary" : ""}`}
                onClick={() => onAnswer(choice.mode)}
                aria-describedby={`paste-hint-${choice.mode}`}
              >
                {choice.label}
                <kbd>{choice.key}</kbd>
              </button>
              <div id={`paste-hint-${choice.mode}`} role="tooltip" className="dialog-hint">
                {choice.hint}
              </div>
            </div>
          ))}
          <span className="dialog-actions-spacer" />
          <button className="dialog-button" onClick={() => onAnswer(null)}>
            Cancel
            <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
