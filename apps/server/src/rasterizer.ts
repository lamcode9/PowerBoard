import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * SVG → pixels, in a child process.
 *
 * Two things go wrong inside libvips that a normal `await` cannot survive, because both end in a
 * native `abort()` rather than a thrown error:
 *
 *  - pango cannot find a font (in the MAS sandbox this is *every* emoji) and calls `g_error()`;
 *  - a very large render exhausts memory.
 *
 * The desktop app runs this server inside the Electron main process, so either one used to take
 * PowerBoard down with it — no message, no export, no window. Isolating the rasterizer turns both
 * into an ordinary failed request that the export dialog can show.
 */
export interface RasterJob {
  svg: string;
  /** DPI handed to librsvg — raising this is what keeps text sharp at 2–4x instead of upscaling pixels. */
  density: number;
  width: number;
  height: number;
  format: "png" | "jpg";
  /** Flatten colour for JPEG, which has no alpha. */
  flatten?: string;
  quality?: number;
}

const WORKER = resolveWorker();
/** A page of several hundred elements at 4x is slow but finite; past this the child is wedged. */
const TIMEOUT_MS = 180_000;

let warnedNoWorker = false;
/** Set if the OS refuses to spawn at all, so we stop paying for a failing spawn on every export. */
let spawnUnavailable = false;

/**
 * In the packaged app this module lives inside app.asar, and a spawned Node process cannot read an
 * archive member — electron-builder unpacks the worker for exactly this reason, so point at the copy
 * that is really on disk.
 */
function resolveWorker(): string {
  const packed = fileURLToPath(new URL("./rasterizeWorker.mjs", import.meta.url));
  const unpacked = packed.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return unpacked !== packed && fs.existsSync(unpacked) ? unpacked : packed;
}

export async function rasterize(job: RasterJob): Promise<Buffer> {
  if (spawnUnavailable || !fs.existsSync(WORKER)) {
    // Serverless (Vercel) bundles the server without the worker file, and does not need it: each
    // invocation is already its own process, so an abort costs one request rather than the app.
    if (!warnedNoWorker) {
      warnedNoWorker = true;
      console.warn(`Rasterizing in-process — worker not found at ${WORKER}.`);
    }
    return rasterizeInProcess(job);
  }

  try {
    return await runWorker(job, {});
  } catch (cause) {
    if (cause instanceof SpawnFailed) {
      // The OS would not start the child (sandbox policy, missing exec permission). Rendering
      // in-process is what this app did before isolation existed, so degrade to that rather than
      // refusing to export at all — loudly, because the crash protection is now gone.
      spawnUnavailable = true;
      console.error(`Cannot spawn the rasterizer worker (${cause.message}) — rendering in-process, unprotected.`);
      return rasterizeInProcess(job);
    }
    if (!(cause instanceof WorkerDied)) throw cause;
    // The child aborted. Overwhelmingly this is pango failing to load a font — in the sandbox that
    // is any emoji at all — so retry on the fontconfig backend, which resolves fonts from the
    // system font directories instead of CoreText. CoreText stays the first choice because it
    // matches what the canvas shows on screen; this path only has to be correct and complete.
    console.warn(`Rasterizer child ${cause.how}; retrying with the fontconfig font backend.`);
    try {
      return await runWorker(job, fontconfigEnv());
    } catch (retry) {
      if (!(retry instanceof WorkerDied)) throw retry;
      throw new Error(
        `The image renderer stopped unexpectedly (${retry.how}). Export this as SVG, or tell us which board it was.`
      );
    }
  }
}

class WorkerDied extends Error {
  constructor(readonly how: string, readonly detail: string) {
    super(`Rasterizer ${how}${detail ? `: ${detail}` : ""}`);
  }
}

/** The child never started, as opposed to starting and dying — a different problem, different answer. */
class SpawnFailed extends Error {}

function runWorker(job: RasterJob, extraEnv: NodeJS.ProcessEnv): Promise<Buffer> {
  const { svg, ...spec } = job;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(spec)], {
      // In the packaged app `execPath` is Electron itself; this makes it boot as plain Node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const out: Buffer[] = [];
    let err = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`The image renderer timed out after ${Math.round(TIMEOUT_MS / 1000)}s.`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SpawnFailed(error.message));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(out));
        return;
      }
      // An abort() arrives as a signal (SIGTRAP/SIGABRT) or, when the shell reports it, a non-zero
      // code; both mean the same thing here — the render died rather than failed.
      reject(new WorkerDied(signal ? `died on ${signal}` : `exited with code ${code}`, lastLine(err)));
    });

    child.stdin.on("error", () => {
      // A child that aborts before reading stdin makes the pipe EPIPE; `close` reports the real cause.
    });
    child.stdin.end(svg);
  });
}

function rasterizeInProcess(job: RasterJob): Promise<Buffer> {
  const image = sharp(Buffer.from(job.svg), { density: job.density }).resize(job.width, job.height);
  if (job.format === "png") return image.png().toBuffer();
  return image.flatten({ background: job.flatten ?? "#FFFFFF" }).jpeg({ quality: job.quality ?? 92 }).toBuffer();
}

let fontconfigDir: string | null = null;

/**
 * A fontconfig setup written on first use. libvips ships fontconfig with no configuration file, so
 * without this it finds no fonts at all and falls back to a serif for everything. The aliases cover
 * the families PowerBoard boards actually ask for — the token default is `Inter, ui-sans-serif,
 * system-ui`, none of which fontconfig knows by name.
 */
function fontconfigEnv(): NodeJS.ProcessEnv {
  if (!fontconfigDir) {
    const dir = path.join(os.tmpdir(), "powerboard-fontconfig");
    fs.mkdirSync(path.join(dir, "cache"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fonts.conf"), FONTS_CONF(path.join(dir, "cache")), "utf8");
    fontconfigDir = dir;
  }
  return {
    PANGOCAIRO_BACKEND: "fc",
    FONTCONFIG_FILE: path.join(fontconfigDir, "fonts.conf")
  };
}

const FONTS_CONF = (cacheDir: string) => `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/System/Library/Fonts</dir>
  <dir>/System/Library/Fonts/Supplemental</dir>
  <dir>/Library/Fonts</dir>
  <cachedir>${cacheDir}</cachedir>
  <alias binding="strong"><family>sans-serif</family><prefer><family>Helvetica Neue</family><family>Helvetica</family><family>Arial</family></prefer></alias>
  <alias binding="strong"><family>system-ui</family><prefer><family>Helvetica Neue</family></prefer></alias>
  <alias binding="strong"><family>ui-sans-serif</family><prefer><family>Helvetica Neue</family></prefer></alias>
  <alias binding="strong"><family>Inter</family><prefer><family>Helvetica Neue</family></prefer></alias>
  <alias binding="strong"><family>emoji</family><prefer><family>Apple Color Emoji</family></prefer></alias>
  <alias binding="strong"><family>monospace</family><prefer><family>Menlo</family><family>Courier New</family></prefer></alias>
</fontconfig>
`;

function lastLine(text: string): string {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "";
}
