import { Bot } from "lucide-react";

export interface AgentFeedEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
  targets: string[];
}

/**
 * Agent presence is a designed surface (Phase 3): a readable feed of what agents did,
 * with click-to-focus on the touched elements — not a log dump.
 */
export function AgentFeed({ entries, onFocusTargets }: { entries: AgentFeedEntry[]; onFocusTargets: (ids: string[]) => void }) {
  if (!entries.length) {
    return (
      <div className="agent-feed-empty">
        <Bot size={20} />
        <p>No agent activity yet.</p>
        <small>Point an agent at the MCP endpoint and its edits stream in here live.</small>
      </div>
    );
  }
  return (
    <div className="agent-feed">
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

function formatFeedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (deltaSeconds < 10) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}
