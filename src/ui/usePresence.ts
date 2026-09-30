import { useEffect, useState } from "react";
import { EXIT_MS } from "../motion";

/**
 * Keeps something on screen for a moment after it goes away, so it can play an exit animation:
 * returns the current value, or the last one while `closing`; null once it is gone.
 */
export function usePresence<T>(value: T | null | undefined | false): { value: T | null; closing: boolean } {
  const [last, setLast] = useState<T | null>(value || null);

  useEffect(() => {
    if (value) {
      setLast(value);
      return;
    }
    const timer = window.setTimeout(() => setLast(null), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  return value ? { value, closing: false } : { value: last, closing: last !== null };
}
