import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "apps", "web");
const distRoot = path.join(webRoot, "dist");

const read = (file) => readFileSync(file, "utf8");
const indexHtml = read(path.join(distRoot, "index.html"));
const manifest = JSON.parse(read(path.join(distRoot, "manifest.webmanifest")));
const serviceWorker = read(path.join(distRoot, "sw.js"));
const mainSource = read(path.join(webRoot, "src", "main.tsx"));

const startupImageCount = (indexHtml.match(/rel="apple-touch-startup-image"/g) ?? []).length;
assert.ok(startupImageCount >= 10, `expected broad iPhone startup coverage, found ${startupImageCount} images`);
assert.match(indexHtml, /href="\/apple-touch-icon\.png"/, "PNG Apple touch icon is required");
assert.match(indexHtml, /launch-1179x2556\.png/, "393×852 @3x iPhone launch image is required");
assert.match(indexHtml, /class="boot-shell"/, "inline boot shell is required");
assert.match(indexHtml, /background-color:\s*#f6f1e7/, "inline non-white root background is required");
assert.match(indexHtml, /id="vite-plugin-pwa:register-sw"[^>]*\sdefer/, "service-worker registration must not block HTML parsing");

assert.equal(manifest.background_color, "#f6f1e7");
assert.equal(manifest.theme_color, "#f6f1e7");
assert.ok(manifest.icons.some((icon) => icon.src === "/icon-192.png" && icon.type === "image/png"));
assert.ok(manifest.icons.some((icon) => icon.src === "/icon-512.png" && icon.type === "image/png"));

assert.doesNotMatch(serviceWorker, /self\.skipWaiting\(\),/, "new service workers must not take over a live cold start");
assert.doesNotMatch(serviceWorker, /clientsClaim\(\)/, "new service workers must not claim a live cold start");
assert.doesNotMatch(mainSource, /requestAnimationFrame\s*\(/, "application loading must not wait for the first animation frame");
assert.match(mainSource, /vite:preloadError/, "stale module preload recovery is required");

assert.ok(existsSync(path.join(distRoot, "apple-touch-icon.png")));
assert.ok(existsSync(path.join(distRoot, "pwa", "launch-1179x2556.png")));

console.log(`PWA startup verification passed (${startupImageCount} iPhone launch images).`);
