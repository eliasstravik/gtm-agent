import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const release = pkg.gtm?.skillsRelease;
if (!release || !/^[A-Za-z0-9._-]+$/.test(release)) throw new Error("package.json gtm.skillsRelease is missing or invalid.");

await rm(new URL("agent/skills", root), { recursive: true, force: true });
const result = spawnSync("npx", ["--yes", "skills", "add", `eliasstravik/gtm-skills#${release}`, "--subagent", "root", "--copy", "--yes"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) throw new Error(`Skills install failed with exit ${result.status ?? "unknown"}.`);
await Promise.all([
  rm(new URL(".agents", root), { recursive: true, force: true }),
  rm(new URL("skills-lock.json", root), { force: true }),
]);
