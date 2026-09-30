import type { Rect } from "./geometry";

export interface TextEditRequest {
  /** Position in host (canvas) pixels. */
  rect: Rect;
  value: string;
  fontSize: number;
  multiline?: boolean;
  align?: "left" | "right";
  inputMode?: "text" | "decimal" | "numeric";
  placeholder?: string;
  onCommit: (value: string) => void;
}

export interface ListPickRequest {
  rect: Rect;
  fontSize: number;
  options: { value: string; label: string }[];
  current: string | null;
  onPick: (value: string) => void;
}

/**
 * One DOM editor at a time, positioned over the canvas: a text field, a text area or an option list.
 * Committing happens on Enter (Ctrl+Enter for text areas) and on blur; Escape cancels.
 */
export class InlineEditor {
  private active: { element: HTMLElement; commit: (() => void) | null } | null = null;
  private readonly onOutsidePointer = (event: PointerEvent) => {
    if (this.active && !this.active.element.contains(event.target as Node)) {
      this.close(true);
    }
  };

  constructor(private readonly host: HTMLElement) {}

  get isOpen(): boolean {
    return this.active !== null;
  }

  editText(request: TextEditRequest): void {
    this.close(true);
    const element = document.createElement(request.multiline ? "textarea" : "input");
    element.className = `ng-inline-editor${request.multiline ? " multiline" : ""}`;
    if (element instanceof HTMLInputElement) {
      element.type = "text";
      element.inputMode = request.inputMode ?? "text";
    }
    element.spellcheck = false;
    element.value = request.value;
    element.placeholder = request.placeholder ?? "";
    place(element, request.rect);
    Object.assign(element.style, { fontSize: `${request.fontSize}px`, textAlign: request.align ?? "left" });

    const commit = () => request.onCommit(element.value);
    element.addEventListener("keydown", (event: Event) => {
      const key = event as KeyboardEvent;
      key.stopPropagation();
      if (key.key === "Escape") {
        key.preventDefault();
        this.close(false);
      } else if (key.key === "Enter" && (!request.multiline || key.ctrlKey || key.metaKey)) {
        key.preventDefault();
        this.close(true);
      }
    });
    element.addEventListener("blur", () => this.close(true));
    this.open(element, commit);
    element.focus();
    element.select();
  }

  pick(request: ListPickRequest): void {
    this.close(true);
    const list = document.createElement("div");
    list.className = "ng-inline-list";
    list.tabIndex = -1;
    place(list, { ...request.rect, height: 0 });
    Object.assign(list.style, { top: `${request.rect.y + request.rect.height + 2}px`, height: "auto", fontSize: `${request.fontSize}px` });

    let highlighted = Math.max(0, request.options.findIndex((option) => option.value === request.current));
    const buttons = request.options.map((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.classList.toggle("current", option.value === request.current);
      button.addEventListener("pointerenter", () => setHighlight(index));
      button.addEventListener("click", () => {
        this.close(false);
        request.onPick(option.value);
      });
      list.appendChild(button);
      return button;
    });
    const setHighlight = (index: number) => {
      highlighted = (index + buttons.length) % buttons.length;
      buttons.forEach((button, buttonIndex) => button.classList.toggle("highlighted", buttonIndex === highlighted));
      buttons[highlighted]?.scrollIntoView({ block: "nearest" });
    };
    list.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "ArrowDown") setHighlight(highlighted + 1);
      else if (event.key === "ArrowUp") setHighlight(highlighted - 1);
      else if (event.key === "Enter") buttons[highlighted]?.click();
      else if (event.key === "Escape") this.close(false);
      else return;
      event.preventDefault();
    });

    this.open(list, null);
    setHighlight(highlighted);
    list.focus();
  }

  close(commit: boolean): void {
    const active = this.active;
    if (!active) {
      return;
    }
    this.active = null;
    window.removeEventListener("pointerdown", this.onOutsidePointer, true);
    if (commit) {
      active.commit?.();
    }
    active.element.remove();
  }

  private open(element: HTMLElement, commit: (() => void) | null): void {
    this.host.appendChild(element);
    this.active = { element, commit };
    window.addEventListener("pointerdown", this.onOutsidePointer, true);
  }
}

function place(element: HTMLElement, rect: Rect): void {
  Object.assign(element.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}
