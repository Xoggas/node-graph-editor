import { mouseControls, type Shortcut, shortcuts } from "../app/shortcuts";
import { t } from "../i18n";

interface ShortcutHelpProps {
  onClose: () => void;
}

/** Four columns side by side; "mouse" is the list of mouse gestures. */
const COLUMNS: (Shortcut["group"] | "mouse")[][] = [["File", "View"], ["Edit"], ["Selection", "Help"], ["mouse"]];

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  return (
    <div className="help-backdrop" onPointerDown={onClose}>
      <div className="help-dialog" role="dialog" aria-label={t("Keyboard shortcuts")} onPointerDown={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span>{t("Keyboard shortcuts")}</span>
          <button className="help-close" onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </div>
        <div className="help-columns">
          {COLUMNS.map((groups) => (
            <div key={groups.join()} className="help-column">
              {groups.map((group) =>
                group === "mouse" ? (
                  <section key={group}>
                    <h3>{t("Mouse")}</h3>
                    {mouseControls.map((control) => (
                      <Row key={control.description} description={control.description} keys={control.keys.map((key) => t(key))} />
                    ))}
                  </section>
                ) : (
                  <section key={group}>
                    <h3>{t(group)}</h3>
                    {shortcuts
                      .filter((shortcut) => shortcut.group === group)
                      .map((shortcut) => (
                        // Key names (Delete, Home…) stay as printed on the keyboard; only "Arrows" is a word.
                        <Row
                          key={shortcut.description}
                          description={shortcut.description}
                          keys={shortcut.keys.map((key) => (key.includes("Arrows") ? t(key) : key))}
                        />
                      ))}
                  </section>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ description, keys }: { description: string; keys: string[] }) {
  return (
    <div className="help-row">
      <span>{t(description)}</span>
      <span className="help-keys">
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </span>
    </div>
  );
}
