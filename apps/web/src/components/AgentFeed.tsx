import { Bot } from "lucide-react";

export interface AgentFeedEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
  targets: string[];
}

/**
 * Agent presence is a designed surface (Phase 4): a readable feed of what agents did, a live
 * "editing…" badge while a burst of ops is in flight, and click-to-focus (which re-pulses the
 * touched elements on the canvas) — not a log dump.
 */
export function AgentFeed({
  entries,
  live,
  onFocusTargets,
  onConnect
}: {
  entries: AgentFeedEntry[];
  live?: boolean;
  onFocusTargets: (ids: string[]) => void;
  onConnect?: () => void;
}) {
  if (!entries.length) {
    return (
      <div className="agent-feed-empty">
        <AgentEmptyMotif />
        <p>No agent activity yet.</p>
        <small>Point an agent at the MCP endpoint — its edits stream in here and each touched element pulses on the canvas.</small>
        {onConnect ? (
          <button type="button" className="agent-empty-connect" onClick={onConnect}>
            <Bot size={14} /> Connect an agent
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="agent-feed">
      {live ? (
        <div className="agent-live-badge" role="status" aria-live="polite">
          <span className="agent-live-dot" aria-hidden="true" />
          editing…
        </div>
      ) : null}
      {entries.map((entry) => (
        <button key={entry.id} className="agent-feed-row" onClick={() => onFocusTargets(entry.targets)} title="Click to focus the edited items">
          <span className="agent-feed-dot" aria-hidden="true" />
          <span className="agent-feed-body">
            <span className="agent-feed-message">{entry.message}</span>
            <span className="agent-feed-meta">
              {entry.actor} · {formatFeedTime(entry.at)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Board grid with a live pulse — echoes the app icon (docs/brand/). Motion respects reduce-motion via CSS. */
function AgentEmptyMotif() {
  return (
    <svg className="agent-empty-motif" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="29" height="29" rx="7" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <line x1="14" y1="8" x2="14" y2="32" stroke="currentColor" strokeWidth="1.2" opacity="0.26" />
      <line x1="26" y1="8" x2="26" y2="32" stroke="currentColor" strokeWidth="1.2" opacity="0.26" />
      <line x1="8" y1="16" x2="32" y2="16" stroke="currentColor" strokeWidth="1.2" opacity="0.26" />
      <circle className="agent-empty-pulse-ring" cx="20" cy="24" r="7" fill="currentColor" />
      <circle className="agent-empty-pulse" cx="20" cy="24" r="3.4" fill="currentColor" />
    </svg>
  );
}

function formatFeedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (deltaSeconds < 10) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}
