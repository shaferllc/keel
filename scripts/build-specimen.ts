/**
 * Renders the UI specimen to `public/specimen.html` — one standalone file with
 * the kit's CSS inlined and the webfonts copied next to it, so it opens from
 * the filesystem with no server and no build step.
 *
 *   npm run build:specimen && open public/specimen.html
 */

import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { View } from "../src/core/view.js";
import { SpecimenPage } from "../src/ui/specimen.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = join(root, "src/ui");
const outDir = join(root, "public");
const fontsOut = join(outDir, "fonts");

/** Site-root font URLs work in an app; the standalone file needs relative ones. */
const fontCss = (await readFile(join(uiDir, "fonts.css"), "utf8")).replaceAll(
  'url("/fonts/',
  'url("./fonts/',
);

const styles = [
  fontCss,
  await readFile(join(uiDir, "theme.css"), "utf8"),
  await readFile(join(uiDir, "components.css"), "utf8"),
].join("\n");

await mkdir(fontsOut, { recursive: true });
for (const file of await readdir(join(uiDir, "fonts"))) {
  if (!file.endsWith(".woff2")) continue;
  await copyFile(join(uiDir, "fonts", file), join(fontsOut, file));
}

const html = await new View().render(SpecimenPage({ styles }));
const out = join(outDir, "specimen.html");
await writeFile(out, html);

console.log(`Wrote ${out} (${(html.length / 1024).toFixed(1)} kB)`);
