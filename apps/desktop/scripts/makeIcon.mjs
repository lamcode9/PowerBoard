// Renders the PowerBoard mark → build/icon.icns (macOS app icon) using sharp + iconutil.
// Hand-tuned per size: tiny sizes drop the pulse rings and thicken the frame/node so the
// mark stays legible; mid sizes keep one ring; large sizes render the full two-ring mark.
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(here, "../build");
const iconset = path.join(buildDir, "icon.iconset");

const src = {
  full: path.join(buildDir, "icon.svg"),          // board + 2 pulse rings + node
  medium: path.join(buildDir, "icon-medium.svg"), // board + 1 pulse ring + node
  small: path.join(buildDir, "icon-small.svg")    // board + node only (no rings)
};

// [filename, pixel size, tuned source for that size]
const sizes = [
  ["icon_16x16.png", 16, src.small], ["icon_16x16@2x.png", 32, src.small],
  ["icon_32x32.png", 32, src.small], ["icon_32x32@2x.png", 64, src.medium],
  ["icon_128x128.png", 128, src.full], ["icon_128x128@2x.png", 256, src.full],
  ["icon_256x256.png", 256, src.full], ["icon_256x256@2x.png", 512, src.full],
  ["icon_512x512.png", 512, src.full], ["icon_512x512@2x.png", 1024, src.full]
];

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

for (const [name, size, svgPath] of sizes) {
  await sharp(svgPath, { density: 300 }).resize(size, size).png().toFile(path.join(iconset, name));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);
rmSync(iconset, { recursive: true, force: true });
console.log("build/icon.icns written (hand-tuned small sizes).");
