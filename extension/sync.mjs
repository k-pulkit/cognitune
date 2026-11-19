// The extension ships the same app as the npm package, so it carries the same version and changelog.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
const root = JSON.parse(readFileSync("package.json", "utf8"));
const ext = JSON.parse(readFileSync("extension/package.json", "utf8"));
if (ext.version !== root.version) {
  ext.version = root.version;
  writeFileSync("extension/package.json", JSON.stringify(ext, null, 2) + "\n");
}
copyFileSync("CHANGELOG.md", "extension/CHANGELOG.md");
