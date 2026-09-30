import { mouseControls, type Shortcut, shortcuts } from "../app/shortcuts";

interface ShortcutHelpProps {
  onClose: () => void;
}

const GROUPS: Shortcut["group"][] = ["File", "Edit", "Selection", "View", "Help"];

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  return (
    <div className="help-backdrop" onPointerDown={onClose}>
      <div className="help-dialog" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
        <div className="help-header">
          <span>Keyboard shortcuts</span>
          <button className="help-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="help-columns">
          {GROUPS.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              {shortcuts
                .filter((shortcut) => shortcut.group === group)
                .map((shortcut) => (
                  <Row key={shortcut.description} description={shortcut.description} keys={shortcut.keys} />
                ))}
            </section>
          ))}
          <section>
            <h3>Mouse</h3>
            {mouseControls.map((control) => (
              <Row key={control.description} description={control.description} keys={control.keys} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ description, keys }: { description: string; keys: string[] }) {
  return (
    <div className="help-row">
      <span>{description}</span>
      <span className="help-keys">
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </span>
    </div>
  );
}
