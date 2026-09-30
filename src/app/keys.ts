/**
 * Physical key of a keyboard event as a `KeyboardEvent.code` value ("KeyZ", "Delete", …).
 *
 * `event.code` is layout independent, but WebView2 can deliver it empty (input without a scan code,
 * e.g. from some layout switchers or remote sessions). Then the Windows virtual key (`keyCode`) is
 * used, which is also layout independent; `key` is the last resort.
 */
export function physicalKey(event: KeyboardEvent): string {
  if (event.code) {
    return event.code;
  }
  return fromKeyCode(event.keyCode) ?? fromKey(event.key) ?? "";
}

const NAMED_KEY_CODES: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  27: "Escape",
  32: "Space",
  36: "Home",
  35: "End",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  45: "Insert",
  46: "Delete",
  107: "NumpadAdd",
  109: "NumpadSubtract",
  187: "Equal",
  189: "Minus",
  191: "Slash",
};

function fromKeyCode(keyCode: number): string | null {
  if (!keyCode) return null;
  if (keyCode >= 65 && keyCode <= 90) return `Key${String.fromCharCode(keyCode)}`;
  if (keyCode >= 48 && keyCode <= 57) return `Digit${keyCode - 48}`;
  if (keyCode >= 96 && keyCode <= 105) return `Numpad${keyCode - 96}`;
  if (keyCode >= 112 && keyCode <= 123) return `F${keyCode - 111}`;
  return NAMED_KEY_CODES[keyCode] ?? null;
}

const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  "=": "Equal",
  "+": "Equal",
  "-": "Minus",
  "/": "Slash",
  "?": "Slash",
};

function fromKey(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (NAMED_KEYS[key]) return NAMED_KEYS[key];
  // Named keys ("Delete", "Escape", "ArrowUp", "F1", …) already match their code.
  return key.length > 1 ? key : null;
}
