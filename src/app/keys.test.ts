import { describe, expect, it } from "vitest";
import { physicalKey } from "./keys";

const event = (init: Partial<KeyboardEvent>) => ({ code: "", key: "", keyCode: 0, ...init }) as KeyboardEvent;

describe("physicalKey", () => {
  it("uses event.code when present", () => {
    expect(physicalKey(event({ code: "KeyZ", key: "я", keyCode: 90 }))).toBe("KeyZ");
  });

  it("falls back to the virtual key when WebView2 sends no code (any layout)", () => {
    expect(physicalKey(event({ key: "я", keyCode: 90 }))).toBe("KeyZ");
    expect(physicalKey(event({ key: "Delete", keyCode: 46 }))).toBe("Delete");
    expect(physicalKey(event({ key: "=", keyCode: 187 }))).toBe("Equal");
    expect(physicalKey(event({ key: "F1", keyCode: 112 }))).toBe("F1");
    expect(physicalKey(event({ key: "0", keyCode: 48 }))).toBe("Digit0");
    expect(physicalKey(event({ key: " ", keyCode: 32 }))).toBe("Space");
  });

  it("falls back to the key name as a last resort", () => {
    expect(physicalKey(event({ key: "a" }))).toBe("KeyA");
    expect(physicalKey(event({ key: "Escape" }))).toBe("Escape");
    expect(physicalKey(event({ key: "?" }))).toBe("Slash");
  });
});
