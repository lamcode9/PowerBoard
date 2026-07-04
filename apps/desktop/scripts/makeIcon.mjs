// Renders build/icon.svg → build/icon.icns (macOS app icon) using sharp + iconutil.
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(here, "../build");
const svgPath = path.join(buildDir, "icon.svg");
const iconset = path.join(buildDir, "icon.iconset");

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const sizes = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024]
];
for (const [name, size] of sizes) {
  await sharp(svgPath, { density: 300 }).resize(size, size).png().toFile(path.join(iconset, name));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);
rmSync(iconset, { recursive: true, force: true });
console.log("build/icon.icns written.");
