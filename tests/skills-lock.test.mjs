import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXPECTED_SKILLS,
  syncVendoredSkills,
  verifyVendoredSkills,
} from "../scripts/sync-gtmskills.mjs";

const root = new URL("../", import.meta.url);
const expected = [
  "gtm-account-research",
  "gtm-account-scoring",
  "gtm-account-segmentation",
  "gtm-context",
  "gtm-icp",
  "gtm-lead-research",
  "gtm-lead-scoring",
  "gtm-lead-segmentation",
  "gtm-persona",
];
const fixtureLicense =
  "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n";

test("the shipping skill allowlist is exact", () => {
  assert.deepEqual(EXPECTED_SKILLS, expected);
});

test("vendored snapshot is either verified or explicitly license-blocked", async () => {
  const lock = JSON.parse(await readFile(new URL("skills-lock.json", root), "utf8"));

  if (lock.status === "blocked_missing_upstream_license") {
    assert.equal(lock.source.url, "https://github.com/eliasstravik/gtmskills.git");
    assert.deepEqual(lock.skills, expected);
    await assert.rejects(
      verifyVendoredSkills(new URL(".", root)),
      /upstream MIT license/i,
    );
    return;
  }

  assert.equal(lock.status, "ready");
  await verifyVendoredSkills(new URL(".", root));
  const installed = (await readdir(new URL("agent/skills/", root), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(installed, expected);
});

test("the CLI entrypoint verifies the ready integrity gate", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("scripts/sync-gtmskills.mjs", root)), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /match skills-lock\.json/i);
});

test("sync copies a clean MIT-licensed snapshot, locks every file, and detects drift", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-skills-sync-"),
  );
  const source = join(temporaryRoot, "source");
  const target = join(temporaryRoot, "target");

  try {
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    git(source, ["init", "--initial-branch=main"]);
    git(source, ["config", "user.email", "fixture@example.test"]);
    git(source, ["config", "user.name", "Fixture"]);
    git(source, [
      "remote",
      "add",
      "origin",
      "https://github.com/eliasstravik/gtmskills.git",
    ]);
    await writeFile(join(source, "LICENSE"), fixtureLicense, "utf8");
    for (const skill of expected) {
      const directory = join(source, "skills", skill);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "SKILL.md"), `# ${skill}\n`, "utf8");
    }
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "fixture"]);

    const lock = await syncVendoredSkills(source, target);
    assert.equal(lock.status, "ready");
    assert.equal(lock.source.license, "LICENSES/gtmskills-MIT.txt");
    assert.match(lock.source.licenseSha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(lock.files).length, expected.length);
    await verifyVendoredSkills(target);

    const originalTargetLock = await readFile(join(target, "skills-lock.json"), "utf8");
    const originalTargetLicense = await readFile(
      join(target, "LICENSES", "gtmskills-MIT.txt"),
      "utf8",
    );
    const originalTargetSkill = await readFile(
      join(target, "agent", "skills", expected[0], "SKILL.md"),
      "utf8",
    );

    await writeFile(join(source, "LICENSE"), `${fixtureLicense}\nlocal edit\n`, "utf8");
    await assert.rejects(
      syncVendoredSkills(source, target),
      /uncommitted shipping skills or license/i,
    );
    assert.equal(await readFile(join(target, "skills-lock.json"), "utf8"), originalTargetLock);
    assert.equal(
      await readFile(join(target, "agent", "skills", expected[0], "SKILL.md"), "utf8"),
      originalTargetSkill,
    );
    await writeFile(join(source, "LICENSE"), fixtureLicense, "utf8");

    await writeFile(
      join(target, "LICENSES", "gtmskills-MIT.txt"),
      `${originalTargetLicense}\ntampered\n`,
      "utf8",
    );
    await assert.rejects(verifyVendoredSkills(target), /license drifted/i);
    await writeFile(
      join(target, "LICENSES", "gtmskills-MIT.txt"),
      originalTargetLicense,
      "utf8",
    );

    const unsafeLink = join(source, "skills", expected.at(-1), "unsafe-link.md");
    await symlink("SKILL.md", unsafeLink);
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "unsafe fixture"]);
    await assert.rejects(syncVendoredSkills(source, target), /symlinks are not allowed/i);
    assert.equal(await readFile(join(target, "skills-lock.json"), "utf8"), originalTargetLock);
    assert.equal(
      await readFile(join(target, "agent", "skills", expected[0], "SKILL.md"), "utf8"),
      originalTargetSkill,
    );

    await writeFile(
      join(target, "agent", "skills", expected[0], "SKILL.md"),
      "tampered\n",
      "utf8",
    );
    await assert.rejects(verifyVendoredSkills(target), /drifted/i);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
