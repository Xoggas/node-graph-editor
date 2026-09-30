import { useEffect, useRef } from "react";
import { setUiLanguage, t, UI_LANGUAGES, type UiLanguage, uiLanguage } from "../i18n";

interface SettingsDialogProps {
  autoExport: boolean;
  onAutoExportChange: (on: boolean) => void;
  showDebug: boolean;
  onShowDebugChange: (on: boolean) => void;
  onClose: () => void;
}

/** Editor preferences: interface language, export on save, debug info in the status bar. */
export function SettingsDialog({ autoExport, onAutoExportChange, showDebug, onShowDebugChange, onClose }: SettingsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onPointerDown={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <h2 id="settings-title">{t("Settings")}</h2>
          <button ref={closeRef} className="settings-close" onClick={onClose} title={t("Close (Esc)")} aria-label={t("Close")}>
            ×
          </button>
        </div>

        <div className="settings-row">
          <label className="settings-text" htmlFor="settings-language">
            <span className="settings-label">{t("Interface language")}</span>
            <span className="settings-hint">{t("Menus, buttons and messages. Node types and fields come from the schema pack.")}</span>
          </label>
          <select id="settings-language" className="settings-select" value={uiLanguage()} onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}>
            {UI_LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="settings-row">
          <span className="settings-text">
            <span className="settings-label">{t("Export on save")}</span>
            <span className="settings-hint">{t("Every save also exports the graph (next to it the first time, then to the last export path)")}</span>
          </span>
          <input type="checkbox" className="settings-check" checked={autoExport} onChange={(event) => onAutoExportChange(event.target.checked)} />
        </label>

        <label className="settings-row">
          <span className="settings-text">
            <span className="settings-label">{t("Show debug info")}</span>
            <span className="settings-hint">{t("Frame time and how many nodes are drawn, in the status bar.")}</span>
          </span>
          <input type="checkbox" className="settings-check" checked={showDebug} onChange={(event) => onShowDebugChange(event.target.checked)} />
        </label>
      </div>
    </div>
  );
}
