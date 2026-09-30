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
  /** Language of the text: turns on spell checking for it. */
  language?: string;
  /** Extra class for a differently styled editor (e.g. "note"). */
  variant?: string;
  /** Line height (px) for text areas that must match the canvas text. */
  lineHeight?: number;
  onCommit: (value: string) => void;
  /** Called after the editor closes, committed or not. */
  onClose?: () => void;
}

export interface ListPickRequest {
  rect: Rect;
  fontSize: number;
  options: { value: string; label: string }[];
  current: string | null;
  /** Shows a filter field above the options. */
  searchable?: boolean;
  emptyText?: string;
  onPick: (value: string) => void;
}

/**
 * One DOM editor at a time, positioned over the canvas: a text field, a text area or an option list.
 * Committing happens on Enter (Ctrl+Enter for text areas) and on blur; Escape cancels.
 */
export class InlineEditor {
  private active: { element: HTMLElement; commit: (() => void) | null; onClose?: () => void } | null = null;
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
    element.className = `ng-inline-editor${request.multiline ? " multiline" : ""}${request.variant ? ` ${request.variant}` : ""}`;
    if (element instanceof HTMLInputElement) {
      element.type = "text";
      element.inputMode = request.inputMode ?? "text";
    }
    element.spellcheck = request.language !== undefined;
    if (request.language) element.lang = request.language;
    element.value = request.value;
    element.placeholder = request.placeholder ?? "";
    place(element, request.rect);
    Object.assign(element.style, { fontSize: `${request.fontSize}px`, textAlign: request.align ?? "left" });
    if (request.lineHeight !== undefined) element.style.lineHeight = `${request.lineHeight}px`;

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
    this.open(element, commit, request.onClose);
    element.focus();
    element.select();
  }

  pick(request: ListPickRequest): void {
    this.close(true);
    const popup = document.createElement("div");
    popup.className = "ng-inline-list";
    popup.tabIndex = -1;
    place(popup, { ...request.rect, height: 0 });
    Object.assign(popup.style, {
      top: `${request.rect.y + request.rect.height + 2}px`,
      height: "auto",
      minWidth: `${Math.max(request.rect.width, request.searchable ? 260 : 120)}px`,
      width: "auto",
      fontSize: `${request.fontSize}px`,
    });

    const search = request.searchable ? document.createElement("input") : null;
    if (search) {
      search.className = "ng-inline-search";
      search.placeholder = "Search…";
      search.spellcheck = false;
      popup.appendChild(search);
    }
    const list = document.createElement("div");
    list.className = "ng-inline-options";
    popup.appendChild(list);
    const empty = document.createElement("div");
    empty.className = "ng-inline-empty";
    empty.textContent = request.emptyText ?? "Nothing found.";

    let visible: { value: string; label: string }[] = [];
    let buttons: HTMLButtonElement[] = [];
    let highlighted = 0;
    const setHighlight = (index: number) => {
      if (buttons.length === 0) return;
      highlighted = (index + buttons.length) % buttons.length;
      buttons.forEach((button, buttonIndex) => button.classList.toggle("highlighted", buttonIndex === highlighted));
      buttons[highlighted].scrollIntoView({ block: "nearest" });
    };
    const render = () => {
      const query = search?.value.trim().toLowerCase() ?? "";
      // The empty choice ("None") is only offered while not searching, so Enter picks a real match.
      visible = query
        ? request.options.filter((option) => option.value !== "" && option.label.toLowerCase().includes(query))
        : request.options;
      list.replaceChildren();
      buttons = visible.map((option, index) => {
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
      if (buttons.length === 0) {
        list.appendChild(empty);
      }
      setHighlight(query ? 0 : Math.max(0, visible.findIndex((option) => option.value === request.current)));
    };

    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "ArrowDown") setHighlight(highlighted + 1);
      else if (event.key === "ArrowUp") setHighlight(highlighted - 1);
      else if (event.key === "Enter") buttons[highlighted]?.click();
      else if (event.key === "Escape") this.close(false);
      else return;
      event.preventDefault();
    };
    popup.addEventListener("keydown", onKey);
    search?.addEventListener("input", render);

    this.open(popup, null);
    render();
    (search ?? popup).focus();
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
    active.onClose?.();
  }

  private open(element: HTMLElement, commit: (() => void) | null, onClose?: () => void): void {
    this.host.appendChild(element);
    this.active = { element, commit, onClose };
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
