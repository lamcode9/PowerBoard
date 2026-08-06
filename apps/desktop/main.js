// PowerBoard desktop shell. Runs the PowerBoard server (Express + WS + MCP) inside the
// Electron main process, then opens a window on it. One process owns UI, storage, and MCP,
// so agents connecting to http://127.0.0.1:4318/mcp always see the board the user sees.
import { app, BrowserWindow, Menu, dialog, session, shell, clipboard } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.POWERBOARD_PORT ?? 4318);
const serverOrigin = `http://127.0.0.1:${port}`;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void main();
}

async function main() {
  await app.whenReady();
  try {
    await startServer();
  } catch (error) {
    dialog.showErrorBox(
      "PowerBoard could not start",
      `The local PowerBoard server failed to start on port ${port}.\n\n${error instanceof Error ? error.message : String(error)}\n\nIf another PowerBoard instance or dev server is running, quit it and reopen PowerBoard.`
    );
    app.quit();
    return;
  }
  Menu.setApplicationMenu(buildMenu());
  installDownloadHandler();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

async function startServer() {
  // Boards live in the app container (offline-first). POWERBOARD_ROOT/STORAGE_MODE can be
  // overridden from the environment for migration/debugging sessions.
  process.env.PORT = String(port);
  // Lets the web UI say "choose where to save" instead of "downloaded" — see /api/health.
  process.env.POWERBOARD_SHELL = "desktop";
  process.env.POWERBOARD_STORAGE_MODE = process.env.POWERBOARD_STORAGE_MODE ?? "local";
  process.env.POWERBOARD_ROOT = process.env.POWERBOARD_ROOT ?? path.join(app.getPath("userData"), "boards");
  process.env.POWERBOARD_BACKUP_DIR = process.env.POWERBOARD_BACKUP_DIR ?? defaultBackupDir();
  process.env.POWERBOARD_WEB_DIST = path.join(here, "dist", "web");
  await import("./dist/server.js");
  await waitForHealth();
}

function defaultBackupDir() {
  // MAS sandbox cannot reach ~/Library/Mobile Documents without an iCloud container
  // entitlement (Phase 2 follow-up); back up inside the app container there so versioned
  // snapshots still exist. Unsandboxed (dev / Developer ID) builds go straight to iCloud Drive.
  if (process.mas) {
    return path.join(app.getPath("userData"), "backups");
  }
  return path.join(app.getPath("home"), "Library", "Mobile Documents", "com~apple~CloudDocs", "PowerBoard", "Backups");
}

// Flush pending board backups before quitting; the server debounces them by 15s, so a
// fast quit right after an edit would otherwise skip the newest snapshot.
let backupFlushed = false;
app.on("before-quit", (event) => {
  if (backupFlushed) return;
  event.preventDefault();
  const finish = () => {
    backupFlushed = true;
    app.quit();
  };
  Promise.race([
    fetch(`${serverOrigin}/api/backups/flush`, { method: "POST" }),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]).then(finish, finish);
});

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverOrigin}/api/health`);
      const health = await response.json();
      if (health?.ok) {
        console.log(`PowerBoard server healthy: storage=${health.storageMode} root=${health.boardRoot}`);
        return;
      }
      lastError = `Health check returned: ${JSON.stringify(health)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(lastError || "Health check timed out.");
}

/**
 * Exported images are downloads, and under App Sandbox a download must go through a save panel:
 * `files.user-selected.read-write` grants access to the path the user picks and nothing else, so
 * writing straight to ~/Downloads would fail. Defaulting the panel to Downloads keeps it one Return
 * press. A failure is reported — an image that silently never lands is the bug this whole feature fixes.
 */
function installDownloadHandler() {
  session.defaultSession.on("will-download", (_event, item) => {
    const fileName = item.getFilename();
    item.setSaveDialogOptions({
      title: "Export image",
      defaultPath: path.join(app.getPath("downloads"), fileName),
      buttonLabel: "Export"
    });
    item.once("done", (_doneEvent, state) => {
      if (state === "completed") {
        shell.showItemInFolder(item.getSavePath());
      } else if (state !== "cancelled") {
        dialog.showErrorBox("Export failed", `PowerBoard could not save ${fileName}. The download ${state}.`);
      }
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: "#E7EDF5",
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.once("ready-to-show", () => win.show());
  // Keep the app inside the board; external links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverOrigin)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  void win.loadURL(serverOrigin);
  return win;
}

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Board",
          accelerator: "CmdOrCtrl+N",
          click: async () => {
            try {
              const response = await fetch(`${serverOrigin}/api/boards`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
              });
              const project = await response.json();
              const win = BrowserWindow.getAllWindows()[0] ?? createWindow();
              await win.loadURL(`${serverOrigin}/#board=${encodeURIComponent(project.id)}`);
            } catch (error) {
              dialog.showErrorBox("New Board failed", error instanceof Error ? error.message : String(error));
            }
          }
        },
        {
          label: "Reveal Boards Folder",
          click: () => shell.openPath(process.env.POWERBOARD_ROOT ?? path.join(app.getPath("userData"), "boards"))
        },
        { type: "separator" },
        {
          label: "Back Up All Boards Now",
          click: async () => {
            try {
              const response = await fetch(`${serverOrigin}/api/backups/flush`, { method: "POST" });
              const result = await response.json();
              const failures = Array.isArray(result?.failed) ? result.failed : [];
              dialog.showMessageBox({
                message: failures.length ? "Backup finished with errors" : "Backup complete",
                detail: failures.length
                  ? failures.map((f) => `${f.boardId}: ${f.error}`).join("\n")
                  : `${(result?.backedUp ?? []).length} board(s) backed up to\n${process.env.POWERBOARD_BACKUP_DIR}`
              });
            } catch (error) {
              dialog.showErrorBox("Backup failed", error instanceof Error ? error.message : String(error));
            }
          }
        },
        {
          label: "Reveal Backups Folder",
          click: () => shell.openPath(process.env.POWERBOARD_BACKUP_DIR ?? "")
        },
        { type: "separator" },
        { role: "close" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Connect an Agent (MCP)…",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              message: "Connect Claude Desktop to PowerBoard",
              detail:
                `PowerBoard exposes its whole workspace over MCP while the app is open — an agent can ` +
                `list, create, rename, and delete boards and edit any board live.\n\n` +
                `Recommended — Claude Desktop → Settings → Connectors → Add custom connector:\n` +
                `    ${serverOrigin}/mcp\n\n` +
                `This shares PowerBoard's live board, so you watch edits land in real time. Keep PowerBoard ` +
                `open while the agent works.\n\n` +
                `Raw endpoints:  HTTP ${serverOrigin}/mcp   ·   REST ${serverOrigin}/api`,
              buttons: ["Copy MCP URL", "Done"],
              defaultId: 0,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) clipboard.writeText(`${serverOrigin}/mcp`);
            });
          }
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}
