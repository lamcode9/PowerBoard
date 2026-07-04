import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface PaletteCommand {
  id: string;
  title: string;
  section: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** ⌘K command palette: every board operation reachable from the keyboard. */
export function CommandPalette({ open, commands, onClose }: { open: boolean; commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) => `${command.title} ${command.section} ${command.keywords ?? ""}`.toLowerCase().includes(needle));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const runCommand = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const sections: Array<{ section: string; items: Array<{ command: PaletteCommand; index: number }> }> = [];
  filtered.forEach((command, index) => {
    const bucket = sections.find((candidate) => candidate.section === command.section);
    if (bucket) bucket.items.push({ command, index });
    else sections.push({ section: command.section, items: [{ command, index }] });
  });

  return (
    <div className="dialog-backdrop palette-backdrop" role="presentation" onPointerDown={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onPointerDown={(event) => event.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Type a command…"
            aria-label="Search commands"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runCommand(filtered[activeIndex]);
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {sections.length ? (
            sections.map(({ section, items }) => (
              <div key={section} className="palette-section">
                <p>{section}</p>
                {items.map(({ command, index }) => (
                  <button
                    key={command.id}
                    data-active={index === activeIndex}
                    className={index === activeIndex ? "palette-item active" : "palette-item"}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                  >
                    <span>{command.title}</span>
                    {command.hint ? <kbd>{command.hint}</kbd> : null}
                  </button>
                ))}
              </div>
            ))
          ) : (
            <p className="palette-empty">No commands match “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
