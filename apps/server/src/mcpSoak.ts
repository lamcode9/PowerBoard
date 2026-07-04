// MCP reliability soak test (Phase 5 gate): drives the real MCP server through an
// in-memory transport with 500 mixed operations — valid edits, invalid inputs, batches,
// idempotent replays, undo/redo — and requires structured errors plus a clean final
// validate_board. Run: npm run soak --prefix apps/server
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createElementFromPreset, createId } from "@powerboard/schema";
import { BoardStore } from "./boardService.js";
import { createBoardMcpServer } from "./mcpServer.js";

const TOTAL_OPS = 500;

interface ToolCallResult {
  ok: boolean;
  errorCode?: string;
  payload?: unknown;
}

async function main(): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "powerboard-soak-"));
  const store = new BoardStore(tempRoot, undefined, "local");
  const server = createBoardMcpServer(store);
  const client = new Client({ name: "powerboard-soak", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> => {
    const result = await client.callTool({ name, arguments: args });
    const textContent = Array.isArray(result.content) && result.content[0]?.type === "text" ? String(result.content[0].text) : "";
    if (result.isError) {
      let errorCode: string | undefined;
      try {
        errorCode = (JSON.parse(textContent) as { error?: { code?: string } }).error?.code;
      } catch {
        // Non-JSON error payloads are a soak failure below.
      }
      return { ok: false, errorCode };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(textContent);
    } catch {
      payload = textContent;
    }
    return { ok: true, payload };
  };

  const fail = (message: string): never => {
    throw new Error(`SOAK FAILED: ${message}`);
  };

  // Setup: one board, one artboard for diagram nodes.
  const created = await call("create_board", { name: "Soak Board" });
  if (!created.ok) fail("create_board errored");
  const boardId = (created.payload as { id: string }).id;
  const canvasId = createId("art");
  const canvas = await call("create_artboard", {
    boardId,
    artboard: { id: canvasId, name: "Soak Canvas", type: "custom", x: 0, y: 0, width: 2400, height: 1600, background: "#F8FAFC", frameless: true }
  });
  if (!canvas.ok) fail("create_artboard errored");

  const elementIds: string[] = [];
  const connectorIds: string[] = [];
  let stats = { valid: 0, invalid: 0, structuredErrors: 0, batches: 0, undos: 0, idempotentReplays: 0 };

  for (let index = 0; index < TOTAL_OPS; index++) {
    const roll = index % 25;

    if (roll === 7) {
      // Deliberately invalid: unknown element id. Must return a structured not_found error.
      const result = await call("update_element", { boardId, elementId: "el_does_not_exist", patch: { x: 10 } });
      if (result.ok) fail(`invalid update_element at op ${index} unexpectedly succeeded`);
      if (result.errorCode !== "not_found") fail(`op ${index}: expected code not_found, got ${result.errorCode ?? "unparseable error"}`);
      stats.invalid++;
      stats.structuredErrors++;
      continue;
    }

    if (roll === 15) {
      // Deliberately invalid schema: negative width. Must be validation_failed or internal with message — require structured JSON.
      const result = await call("move_resize_element", { boardId, elementId: elementIds[0] ?? "el_none", width: -10 });
      if (result.ok) fail(`invalid move_resize at op ${index} unexpectedly succeeded`);
      if (!result.errorCode) fail(`op ${index}: error payload was not structured JSON`);
      stats.invalid++;
      stats.structuredErrors++;
      continue;
    }

    if (roll === 20 && elementIds.length >= 4) {
      // Atomic batch with a bad tail op — must roll back entirely.
      const before = await call("get_board_status", { boardId });
      const beforeCount = ((before.payload as { board: { elements: number } }).board).elements;
      const batch = await call("batch_operations", {
        boardId,
        operations: [
          { type: "add_element", element: { ...createElementFromPreset("shape", canvasId, 50, 50) } },
          { type: "update_element", elementId: "el_missing", patch: { x: 1 } }
        ]
      });
      if (batch.ok) fail(`batch with invalid op at ${index} unexpectedly succeeded`);
      const after = await call("get_board_status", { boardId });
      const afterCount = ((after.payload as { board: { elements: number } }).board).elements;
      if (afterCount !== beforeCount) fail(`batch was not atomic at op ${index}: ${beforeCount} -> ${afterCount}`);
      stats.batches++;
      continue;
    }

    if (roll === 21) {
      // Idempotency: same key twice must not double-apply.
      const key = `soak-${index}`;
      const element = createElementFromPreset("sticky", canvasId, 100 + index, 200);
      const first = await call("add_element", { boardId, element, idempotencyKey: key });
      const replay = await call("add_element", { boardId, element, idempotencyKey: key });
      if (!first.ok || !replay.ok) fail(`idempotent add_element failed at op ${index}`);
      const status = await call("get_board_status", { boardId });
      const project = await store.readBoard(boardId);
      if (project.elements.filter((candidate) => candidate.id === element.id).length !== 1) {
        fail(`idempotency key did not prevent double-apply at op ${index}`);
      }
      elementIds.push(element.id);
      void status;
      stats.idempotentReplays++;
      continue;
    }

    if (roll === 22 && elementIds.length > 2) {
      const undo = await call("board_undo", { boardId });
      const redo = await call("board_redo", { boardId });
      if (!undo.ok || !redo.ok) fail(`undo/redo failed at op ${index}`);
      stats.undos++;
      continue;
    }

    if (roll === 23 && elementIds.length >= 3) {
      // Valid batch: connect two nodes + relayout.
      const from = elementIds[Math.floor(Math.random() * elementIds.length)]!;
      const to = elementIds[Math.floor(Math.random() * elementIds.length)]!;
      const connectorId = createId("conn");
      const batch = await call("batch_operations", {
        boardId,
        operations: [
          {
            type: "add_connector",
            connector: { id: connectorId, fromArtboardId: canvasId, toArtboardId: canvasId, fromElementId: from, toElementId: to, routing: "orthogonal", label: `edge ${index}` }
          },
          { type: "apply_layout", layout: "flow", artboardId: canvasId, spacingX: 90, spacingY: 70 }
        ]
      });
      if (!batch.ok) fail(`valid batch failed at op ${index}`);
      connectorIds.push(connectorId);
      stats.batches++;
      stats.valid++;
      continue;
    }

    // Default: valid single operations, rotating through element kinds and edits.
    const kinds = ["shape", "sticky", "text", "card", "badge"] as const;
    const kind = kinds[index % kinds.length]!;
    if (elementIds.length > 0 && roll % 3 === 1) {
      const target = elementIds[index % elementIds.length]!;
      const result = await call("update_element", { boardId, elementId: target, patch: { name: `Soak ${index}`, style: { fill: "#EEF2FF" } } });
      if (!result.ok) fail(`update_element failed at op ${index}`);
    } else if (elementIds.length > 5 && roll % 7 === 4) {
      const target = elementIds.pop()!;
      const result = await call("delete_element", { boardId, elementId: target });
      if (!result.ok) fail(`delete_element failed at op ${index}`);
    } else {
      const element = createElementFromPreset(kind, canvasId, (index * 37) % 2000, (index * 53) % 1200);
      const result = await call("add_element", { boardId, element });
      if (!result.ok) fail(`add_element failed at op ${index}`);
      elementIds.push(element.id);
    }
    stats.valid++;
  }

  // Final gate: board must validate clean (no errors) and exports must succeed.
  const validation = await call("validate_board", { boardId });
  if (!validation.ok) fail("final validate_board errored");
  const report = validation.payload as { valid: boolean; summary: { errors: number } };
  if (!report.valid || report.summary.errors > 0) fail(`final board has ${report.summary.errors} validation errors`);

  const mermaid = await call("export_mermaid", { boardId });
  const pageSvg = await call("export_page_svg", { boardId });
  if (!mermaid.ok || !pageSvg.ok) fail("final exports failed");

  const depths = await store.historyDepths(boardId);
  console.log(
    JSON.stringify(
      { ok: true, totalOps: TOTAL_OPS, stats, finalElements: (await store.readBoard(boardId)).elements.length, connectors: connectorIds.length, historyDepths: depths },
      null,
      2
    )
  );

  await client.close();
  await server.close();
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
