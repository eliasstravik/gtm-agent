import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_SOURCE_URL =
  "https://github.com/eliasstravik/gtm-skills.git";

export const EXPECTED_SKILLS = [
  "gtm-icp",
  "gtm-persona",
  "gtm-workflow",
  "gtm-workspace",
];

const LEGACY_TRANSITION_SKILLS = [
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

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockName = "skills-lock.json";
const vendoredLicensePath = "LICENSES/gtm-skills-MIT.txt";
const legacyVendoredLicenseName = "LICENSE";

export async function syncVendoredSkills(sourceRoot, projectRoot = scriptRoot) {
  const source = resolvePath(sourceRoot);
  const target = resolvePath(projectRoot);

  assertExpectedRemote(source);
  const sourceLicense = await findMitLicense(source);
  assertShippingPathsClean(source, sourceLicense);
  await assertExpectedSourceSkills(source);
  await assertNoUnexpectedTargetSkills(target, { allowTransitionEntries: true });

  await mkdir(target, { recursive: true });
  const candidateRoot = await mkdtemp(join(target, ".gtm-skills-candidate-"));
  const skillsDirectory = join(candidateRoot, "agent", "skills");
  await mkdir(skillsDirectory, { recursive: true });
  try {
    for (const skill of EXPECTED_SKILLS) {
      await copyRegularTree(
        join(source, "skills", skill),
        join(skillsDirectory, skill),
      );
    }
    const candidateLicense = join(candidateRoot, vendoredLicensePath);
    await mkdir(dirname(candidateLicense), { recursive: true });
    await cp(sourceLicense, candidateLicense);

    const lock = {
      version: 1,
      status: "ready",
      source: {
        url: EXPECTED_SOURCE_URL,
        commit: git(source, ["rev-parse", "HEAD"]),
        license: vendoredLicensePath,
        licenseSha256: await hashFile(candidateLicense),
      },
      skills: [...EXPECTED_SKILLS],
      files: await hashVendoredFiles(skillsDirectory),
    };
    await writeFile(
      join(candidateRoot, lockName),
      `${JSON.stringify(lock, null, 2)}\n`,
      "utf8",
    );
    await verifyVendoredSkills(candidateRoot);
    await installCandidateSnapshot(candidateRoot, target);
    return lock;
  } finally {
    await rm(candidateRoot, { recursive: true, force: true });
  }
}

export async function verifyVendoredSkills(projectRoot = scriptRoot) {
  const target = resolvePath(projectRoot);
  const lock = JSON.parse(await readFile(join(target, lockName), "utf8"));

  if (lock.status === "blocked_missing_upstream_license") {
    throw new Error(
      "Vendored GTM skills are blocked until the upstream MIT license exists. Run skills:sync only after that separate release prerequisite is complete.",
    );
  }
  if (lock.version !== 1 || lock.status !== "ready") {
    throw new Error("skills-lock.json has an unsupported format or status.");
  }
  if (
    lock.source?.url !== EXPECTED_SOURCE_URL ||
    typeof lock.source?.commit !== "string" ||
    !/^[0-9a-f]{40}$/i.test(lock.source.commit) ||
    lock.source?.license !== vendoredLicensePath ||
    typeof lock.source?.licenseSha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(lock.source.licenseSha256)
  ) {
    throw new Error("skills-lock.json has invalid source metadata.");
  }
  if (!isDeepStrictEqual(lock.skills, EXPECTED_SKILLS)) {
    throw new Error("skills-lock.json does not contain the exact shipping skill list.");
  }

  await assertNoUnexpectedTargetSkills(target);
  const skillsDirectory = join(target, "agent", "skills");
  const installed = (await readdir(skillsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!isDeepStrictEqual(installed, EXPECTED_SKILLS)) {
    throw new Error("Vendored skill directories do not match the exact shipping list.");
  }

  const actualFiles = await hashVendoredFiles(skillsDirectory);
  const lockedFiles = lock.files;
  if (
    typeof lockedFiles !== "object" ||
    lockedFiles === null ||
    JSON.stringify(actualFiles) !== JSON.stringify(lockedFiles)
  ) {
    throw new Error("Vendored skill files drifted from skills-lock.json.");
  }

  const licensePath = join(target, vendoredLicensePath);
  const license = await readFile(licensePath, "utf8");
  assertMitLicenseText(license);
  if ((await hashFile(licensePath)) !== lock.source.licenseSha256) {
    throw new Error("Vendored GTM Skills license drifted from skills-lock.json.");
  }
}

async function assertExpectedSourceSkills(source) {
  const entries = await readdir(join(source, "skills"), { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!isDeepStrictEqual(directories, EXPECTED_SKILLS)) {
    throw new Error("Upstream skills directory does not match the exact shipping list.");
  }
}

async function assertNoUnexpectedTargetSkills(
  projectRoot,
  { allowTransitionEntries = false } = {},
) {
  const skillsDirectory = join(projectRoot, "agent", "skills");
  let entries;
  try {
    entries = await readdir(skillsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const lockedTransitionSkills = allowTransitionEntries
    ? await readLegacyTransitionSkillNames(projectRoot)
    : new Set();
  const unexpected = entries.filter(
    (entry) =>
      !(
        allowTransitionEntries &&
        entry.isFile() &&
        entry.name === legacyVendoredLicenseName
      ) &&
      !(
        entry.isDirectory() &&
        (EXPECTED_SKILLS.includes(entry.name) ||
          lockedTransitionSkills.has(entry.name))
      ),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected entry under agent/skills: ${unexpected.map((entry) => entry.name).join(", ")}.`,
    );
  }
}

async function readLegacyTransitionSkillNames(projectRoot) {
  try {
    const lock = JSON.parse(await readFile(join(projectRoot, lockName), "utf8"));
    if (!isDeepStrictEqual(lock.skills, LEGACY_TRANSITION_SKILLS)) {
      return new Set();
    }
    return new Set(LEGACY_TRANSITION_SKILLS);
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return new Set();
    throw error;
  }
}

async function findMitLicense(source) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const candidate = join(source, name);
    try {
      const contents = await readFile(candidate, "utf8");
      assertMitLicenseText(contents);
      return candidate;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error(
    "The upstream gtm-skills checkout has no MIT license. Do not vendor it until the separate licensing prerequisite is complete.",
  );
}

function assertMitLicenseText(contents) {
  if (
    !/MIT License/i.test(contents) ||
    !/Permission is hereby granted/i.test(contents)
  ) {
    throw new Error("The upstream license is not a recognizable MIT license.");
  }
}

function assertExpectedRemote(source) {
  const remote = git(source, ["remote", "get-url", "origin"]);
  if (remote !== EXPECTED_SOURCE_URL) {
    throw new Error(
      `Refusing unexpected gtm-skills source remote: ${JSON.stringify(remote)}.`,
    );
  }
}

function assertShippingPathsClean(source, sourceLicense) {
  const licensePath = relative(source, sourceLicense).split(sep).join("/");
  const status = git(source, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...EXPECTED_SKILLS.map((skill) => `skills/${skill}`),
    licensePath,
  ]);
  if (status.length > 0) {
    throw new Error("Refusing to vendor uncommitted shipping skills or license content.");
  }
  const committedLicense = git(source, [
    "ls-tree",
    "--name-only",
    "HEAD",
    "--",
    licensePath,
  ]);
  if (committedLicense !== licensePath) {
    throw new Error("Refusing an upstream license that is not committed at HEAD.");
  }
}

async function installCandidateSnapshot(candidateRoot, target) {
  const suffix = candidateRoot.slice(candidateRoot.lastIndexOf(sep) + 1);
  const targetAgent = join(target, "agent");
  const targetSkills = join(targetAgent, "skills");
  const targetLock = join(target, lockName);
  const targetLicense = join(target, vendoredLicensePath);
  const backupSkills = join(targetAgent, `.skills-backup-${suffix}`);
  const backupLock = join(target, `.skills-lock-backup-${suffix}.json`);
  const backupLicense = join(target, `.gtm-skills-license-backup-${suffix}.txt`);
  let hadSkills = false;
  let hadLock = false;
  let hadLicense = false;

  await mkdir(targetAgent, { recursive: true });
  await mkdir(dirname(targetLicense), { recursive: true });
  try {
    hadSkills = await moveIfPresent(targetSkills, backupSkills);
    hadLock = await moveIfPresent(targetLock, backupLock);
    hadLicense = await moveIfPresent(targetLicense, backupLicense);
    await rename(join(candidateRoot, "agent", "skills"), targetSkills);
    await rename(join(candidateRoot, lockName), targetLock);
    await rename(join(candidateRoot, vendoredLicensePath), targetLicense);
    await verifyVendoredSkills(target);
  } catch (error) {
    await rm(targetSkills, { recursive: true, force: true });
    await rm(targetLock, { force: true });
    await rm(targetLicense, { force: true });
    if (hadSkills) await rename(backupSkills, targetSkills);
    if (hadLock) await rename(backupLock, targetLock);
    if (hadLicense) await rename(backupLicense, targetLicense);
    throw error;
  }
  await rm(backupSkills, { recursive: true, force: true });
  await rm(backupLock, { force: true });
  await rm(backupLicense, { force: true });
}

async function moveIfPresent(source, destination) {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function copyRegularTree(source, destination) {
  const sourceStats = await lstat(source);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error(`Expected a regular skill directory: ${source}.`);
  }
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in vendored skills: ${sourcePath}.`);
    }
    if (entry.isDirectory()) {
      await copyRegularTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await cp(sourcePath, destinationPath);
    } else {
      throw new Error(`Unsupported entry in vendored skill: ${sourcePath}.`);
    }
  }
}

async function hashVendoredFiles(skillsDirectory) {
  const files = [];
  await collectFiles(skillsDirectory, skillsDirectory, files);
  files.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );

  const hashes = {};
  for (const file of files) {
    const contents = await readFile(file.path);
    hashes[file.relativePath] = createHash("sha256").update(contents).digest("hex");
  }
  return hashes;
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function collectFiles(root, directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in vendored skills: ${path}.`);
    }
    if (entry.isDirectory()) {
      await collectFiles(root, path, files);
    } else if (entry.isFile()) {
      files.push({
        path,
        relativePath: relative(root, path).split(sep).join("/"),
      });
    }
  }
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolvePath(value) {
  return value instanceof URL ? fileURLToPath(value) : resolve(value);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    if (args.length !== 1) throw new Error("--check accepts no source path.");
    await verifyVendoredSkills(scriptRoot);
    console.log("Vendored GTM skills match skills-lock.json.");
    return;
  }

  if (args.length > 1) {
    throw new Error("Usage: node scripts/sync-gtm-skills.mjs [source-path] | --check");
  }
  const source = args[0] ?? resolve(scriptRoot, "..", "gtm-skills");
  const lock = await syncVendoredSkills(source, scriptRoot);
  console.log(
    `Vendored ${lock.skills.length} GTM skills from ${lock.source.commit}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
