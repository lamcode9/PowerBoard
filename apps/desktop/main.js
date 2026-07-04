// PowerBoard desktop shell. Runs the PowerBoard server (Express + WS + MCP) inside the
// Electron main process, then opens a window on it. One process owns UI, storage, and MCP,
// so agents connecting to http://127.0.0.1:4318/mcp always see the board the user sees.
import { app, BrowserWindow, Menu, dialog, shell } from "electron";
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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

async function startServer() {
  // Boards live in the app container (offline-first). POWERBOARD_ROOT/STORAGE_MODE can be
  // overridden from the environment for migration/debugging sessions.
  process.env.PORT = String(port);
  process.env.POWERBOARD_STORAGE_MODE = process.env.POWERBOARD_STORAGE_MODE ?? "local";
  process.env.POWERBOARD_ROOT = process.env.POWERBOARD_ROOT ?? path.join(app.getPath("userData"), "boards");
  process.env.POWERBOARD_WEB_DIST = path.join(here, "dist", "web");
  await import("./dist/server.js");
  await waitForHealth();
}

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
          label: "MCP Endpoint",
          click: () => {
            dialog.showMessageBox({
              message: "Agent access",
              detail: `Agents can edit this board live via MCP:\n\nHTTP: ${serverOrigin}/mcp\nAPI: ${serverOrigin}/api\n\nThe server runs whenever PowerBoard is open.`
            });
          }
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}
