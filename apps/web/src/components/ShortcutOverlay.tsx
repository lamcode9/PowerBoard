import { X } from "lucide-react";

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: "Canvas",
    rows: [
      ["Space + drag", "Pan"],
      ["⌘ + scroll", "Zoom at cursor"],
      ["⌘0", "Reset zoom"],
      ["⌘1", "Fit all frames"],
      ["Drag on canvas", "Marquee select"],
      ["Double-click text", "Edit in place"]
    ]
  },
  {
    title: "Edit",
    rows: [
      ["⌘Z / ⌘⇧Z", "Undo / Redo"],
      ["⌘D", "Duplicate"],
      ["⌘G", "Group"],
      ["⌫", "Delete selection"],
      ["Arrows / ⇧+Arrows", "Nudge 1px / 10px"],
      ["Esc", "Clear selection"]
    ]
  },
  {
    title: "App",
    rows: [
      ["⌘K", "Command palette"],
      ["?", "This overlay"]
    ]
  }
];

export function ShortcutOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <div className="shortcut-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onPointerDown={(event) => event.stopPropagation()}>
        <div className="restore-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shortcut-columns">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcut-group">
              <p>{group.title}</p>
              {group.rows.map(([keys, action]) => (
                <div key={keys} className="shortcut-row">
                  <kbd>{keys}</kbd>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
