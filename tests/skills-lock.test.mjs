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
} from "../scripts/sync-gtm-skills.mjs";

const root = new URL("../", import.meta.url);
const expected = ["gtm-icp", "gtm-persona", "gtm-workspace"];
const legacyTransitionSkills = [
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
    assert.equal(lock.source.url, "https://github.com/eliasstravik/gtm-skills.git");
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
    [fileURLToPath(new URL("scripts/sync-gtm-skills.mjs", root)), "--check"],
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
    await mkdir(target, { recursive: true });
    await createUpstreamFixture(source);

    const lock = await syncVendoredSkills(source, target);
    assert.equal(lock.status, "ready");
    assert.equal(lock.source.license, "LICENSES/gtm-skills-MIT.txt");
    assert.match(lock.source.licenseSha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(lock.files).length, expected.length);
    await verifyVendoredSkills(target);

    const originalTargetLock = await readFile(join(target, "skills-lock.json"), "utf8");
    const originalTargetLicense = await readFile(
      join(target, "LICENSES", "gtm-skills-MIT.txt"),
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
      join(target, "LICENSES", "gtm-skills-MIT.txt"),
      `${originalTargetLicense}\ntampered\n`,
      "utf8",
    );
    await assert.rejects(verifyVendoredSkills(target), /license drifted/i);
    await writeFile(
      join(target, "LICENSES", "gtm-skills-MIT.txt"),
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

test("sync tolerates the exact legacy nine-skill snapshot during the one-time transition", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-skills-transition-"),
  );
  const source = join(temporaryRoot, "source");
  const target = join(temporaryRoot, "target");

  try {
    await createUpstreamFixture(source);
    for (const skill of legacyTransitionSkills) {
      const directory = join(target, "agent", "skills", skill);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "SKILL.md"), `# Legacy ${skill}\n`, "utf8");
    }
    await writeFile(join(target, "agent", "skills", "LICENSE"), fixtureLicense, "utf8");
    await writeFile(
      join(target, "skills-lock.json"),
      `${JSON.stringify({ skills: legacyTransitionSkills }, null, 2)}\n`,
      "utf8",
    );

    await syncVendoredSkills(source, target);
    assert.deepEqual(
      (await readdir(join(target, "agent", "skills"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
      expected,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("sync refuses a rogue safe-looking lock entry and leaves the target unchanged", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-skills-rogue-transition-"),
  );
  const source = join(temporaryRoot, "source");
  const target = join(temporaryRoot, "target");
  const rogueSkill = join(target, "agent", "skills", "rogue-skill");

  try {
    await createUpstreamFixture(source);
    await mkdir(rogueSkill, { recursive: true });
    await writeFile(join(rogueSkill, "SKILL.md"), "# Rogue skill\n", "utf8");
    const originalLock = `${JSON.stringify({ skills: ["rogue-skill"] }, null, 2)}\n`;
    await writeFile(join(target, "skills-lock.json"), originalLock, "utf8");

    await assert.rejects(
      syncVendoredSkills(source, target),
      /unexpected entry under agent\/skills: rogue-skill/i,
    );
    assert.equal(await readFile(join(target, "skills-lock.json"), "utf8"), originalLock);
    assert.equal(await readFile(join(rogueSkill, "SKILL.md"), "utf8"), "# Rogue skill\n");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("malformed, unsafe, and non-array lock skills provide no transition tolerance", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-skills-invalid-transition-"),
  );
  const source = join(temporaryRoot, "source");

  try {
    await createUpstreamFixture(source);
    const cases = [
      ["malformed", "{not json\n"],
      ["unsafe", `${JSON.stringify({ skills: ["../legacy-skill"] })}\n`],
      ["non-array", `${JSON.stringify({ skills: "legacy-skill" })}\n`],
    ];

    for (const [name, lockContents] of cases) {
      const target = join(temporaryRoot, `target-${name}`);
      const legacySkill = join(target, "agent", "skills", "legacy-skill");
      await mkdir(legacySkill, { recursive: true });
      await writeFile(join(legacySkill, "SKILL.md"), "# Legacy skill\n", "utf8");
      await writeFile(join(target, "skills-lock.json"), lockContents, "utf8");

      await assert.rejects(
        syncVendoredSkills(source, target),
        /unexpected entry under agent\/skills: legacy-skill/i,
      );
      assert.equal(await readFile(join(target, "skills-lock.json"), "utf8"), lockContents);
      assert.equal(await readFile(join(legacySkill, "SKILL.md"), "utf8"), "# Legacy skill\n");
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("verification refuses a lock that claims a rogue skill directory", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-skills-rogue-lock-"),
  );
  const source = join(temporaryRoot, "source");
  const target = join(temporaryRoot, "target");

  try {
    await createUpstreamFixture(source);
    await syncVendoredSkills(source, target);

    const lockPath = join(target, "skills-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.skills.push("rogue-skill");
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await assert.rejects(verifyVendoredSkills(target), /exact shipping skill list/i);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function createUpstreamFixture(source) {
  await mkdir(source, { recursive: true });
  git(source, ["init", "--initial-branch=main"]);
  git(source, ["config", "user.email", "fixture@example.test"]);
  git(source, ["config", "user.name", "Fixture"]);
  git(source, [
    "remote",
    "add",
    "origin",
    "https://github.com/eliasstravik/gtm-skills.git",
  ]);
  await writeFile(join(source, "LICENSE"), fixtureLicense, "utf8");
  for (const skill of expected) {
    const directory = join(source, "skills", skill);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "SKILL.md"), `# ${skill}\n`, "utf8");
  }
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "fixture"]);
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
