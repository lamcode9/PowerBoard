import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_TOOLS = [
  "list_boards",
  "read_board",
  "summarize_board",
  "create_board",
  "rename_board",
  "delete_board",
  "list_board_files",
  "create_artboard",
  "update_artboard",
  "create_variant",
  "add_element",
  "preview_operation",
  "update_element",
  "delete_element",
  "move_resize_element",
  "get_selection",
  "set_selection",
  "describe_selection",
  "inspect_selection",
  "export_selection_handoff",
  "inspect_board_hierarchy",
  "add_connector",
  "import_screenshot_overlay",
  "export_artboard_png",
  "export_page_png",
  "export_react_tailwind",
  "export_board_spec",
  "validate_board",
  "update_connector",
  "delete_connector",
  "delete_artboard",
  "apply_layout",
  "batch_operations",
  "get_board_status",
  "board_undo",
  "board_redo",
  "read_oplog",
  "export_page_svg",
  "export_page_pdf",
  "export_mermaid"
] as const;

async function main(): Promise<void> {
  const requireCloud = process.argv.includes("--require-cloud");
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tempRoot = requireCloud ? undefined : await fs.mkdtemp(path.join(os.tmpdir(), "powerboard-mcp-check-"));
  const env = childEnv();
  // Exposure check must exercise *this* build's tool surface. Left to itself the stdio entrypoint
  // attaches to a running PowerBoard when one is listening, which would check the installed app instead.
  env.POWERBOARD_MCP_EMBEDDED = "1";

  if (requireCloud) {
    env.POWERBOARD_STORAGE_MODE = "cloud";
    env.POWERBOARD_CLOUD_DRIVER ??= "supabase";
    if (!env.SUPABASE_DB_URL) {
      throw new Error("--require-cloud needs SUPABASE_DB_URL so the stdio MCP server can start in cloud mode.");
    }
  } else {
    env.POWERBOARD_ROOT = tempRoot!;
    env.POWERBOARD_STORAGE_MODE = env.SUPABASE_DB_URL ? env.POWERBOARD_STORAGE_MODE ?? "cloud" : "local";
    if (env.POWERBOARD_STORAGE_MODE === "cloud") {
      env.POWERBOARD_CLOUD_DRIVER ??= "supabase";
    }
  }

  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: "npm",
    args: ["run", "mcp", "--silent"],
    cwd: serverRoot,
    env,
    stderr: "pipe"
  });
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));

  const client = new Client({ name: "powerboard-mcp-check", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 15_000 });
    const result = await client.listTools(undefined, { timeout: 15_000 });
    const toolNames = result.tools.map((tool) => tool.name).sort();
    const missing = REQUIRED_TOOLS.filter((toolName) => !toolNames.includes(toolName));
    if (missing.length) {
      throw new Error(`MCP tool exposure check failed. Missing tools: ${missing.join(", ")}`);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: REQUIRED_TOOLS.length,
          exposed: toolNames.length,
          storageMode: env.POWERBOARD_STORAGE_MODE,
          requiredTools: REQUIRED_TOOLS
        },
        null,
        2
      )
    );
  } catch (error) {
    const stderrText = stderr.join("").trim();
    if (stderrText) {
      console.error(stderrText);
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function childEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
