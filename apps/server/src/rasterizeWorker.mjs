// The rasterizer, in its own process.
//
// libvips renders SVG through librsvg → pango, and pango answers "I cannot find a font" with
// g_error(), which is unconditionally fatal — it calls abort(). Inside the Electron main process
// that abort kills PowerBoard itself: the window disappears, no error is shown, and no JS
// try/catch can intervene. Out here an abort is just a dead child with a signal, which the parent
// turns into a normal rejected promise.
//
// Plain .mjs on purpose: it is copied verbatim into the packaged app next to dist/server.js, so it
// runs identically under `tsx` in dev and under `ELECTRON_RUN_AS_NODE` in the shipped app, with no
// build step of its own.
//
// Protocol — job JSON on argv[2], SVG bytes on stdin, image bytes on stdout, message on stderr.
import sharp from "sharp";

const job = JSON.parse(process.argv[2] ?? "{}");

const svg = await readStdin();
if (!svg.length) {
  process.stderr.write("No SVG received on stdin.\n");
  process.exit(2);
}

const image = sharp(svg, { density: job.density }).resize(job.width, job.height);
const buffer =
  job.format === "png"
    ? await image.png().toBuffer()
    : await image.flatten({ background: job.flatten ?? "#FFFFFF" }).jpeg({ quality: job.quality ?? 92 }).toBuffer();

await write(buffer);
process.exit(0);

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
    process.stdin.on("error", reject);
  });
}

/** stdout is a pipe, so a large image needs the drain callback — writing and exiting truncates it. */
function write(buffer) {
  return new Promise((resolve, reject) => {
    process.stdout.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}
