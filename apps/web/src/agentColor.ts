/**
 * A board can be held by several agents at once, so each needs to be tellable apart at a glance —
 * on the canvas reticle, in the activity feed, and on the live badges. Six lanes is enough for any
 * realistic session and keeps the palette curated rather than generated: lane 0 *is* the app accent,
 * so the common single-agent case looks exactly as it always has, and the rest sit in the same
 * family. The actual channel values live in `styles.css` so they stay mode-aware.
 *
 * The lane comes from a hash of the agent id, not arrival order: an agent keeps its colour across
 * reconnects and page reloads, which is what makes "that's the teal one again" a usable memory.
 */
const LANE_COUNT = 6;

export function agentLane(agentId: string): number {
  if (!agentId || agentId === "agent") return 0;
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0;
  }
  return hash % LANE_COUNT;
}

/** RGB channel triple for an agent, as a CSS value usable inside `rgba(…)`. */
export function agentRgb(agentId: string): string {
  return `var(--agent-lane-${agentLane(agentId)})`;
}
