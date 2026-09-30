import type { Rect } from "./geometry";
import { removeAfterExit } from "./InlineEditor";

const GAP = 6;
const MARGIN = 8;

/** A description popup under the "?" icon of a node header (host-relative coordinates). */
export class NodeTooltip {
  private element: HTMLDivElement | null = null;
  private anchorKey: string | null = null;

  constructor(private readonly host: HTMLElement) {}

  /** `key` identifies the anchor, so hovering the same icon again does not rebuild the popup. */
  show(key: string, anchor: Rect, title: string, description: string): void {
    if (this.anchorKey === key && this.element) {
      return;
    }
    this.hide();
    const element = document.createElement("div");
    element.className = "ng-node-tooltip";
    const heading = element.appendChild(document.createElement("div"));
    heading.className = "ng-node-tooltip-title";
    heading.textContent = title;
    const body = element.appendChild(document.createElement("div"));
    body.className = "ng-node-tooltip-body";
    body.textContent = description;
    this.host.appendChild(element);

    // Above and to the right of the icon, so it does not cover the node; below it or shifted left
    // when it does not fit in the canvas.
    const { width, height } = element.getBoundingClientRect();
    const hostWidth = this.host.clientWidth;
    const hostHeight = this.host.clientHeight;
    const left = Math.max(MARGIN, Math.min(anchor.x + anchor.width / 2, hostWidth - width - MARGIN));
    let top = anchor.y - GAP - height;
    if (top < MARGIN) {
      top = Math.min(anchor.y + anchor.height + GAP, hostHeight - height - MARGIN);
    }
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
    this.element = element;
    this.anchorKey = key;
  }

  hide(): void {
    if (this.element) removeAfterExit(this.element);
    this.element = null;
    this.anchorKey = null;
  }
}
