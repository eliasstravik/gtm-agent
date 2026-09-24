import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { allow, exports, home, repo, token } from "./lib/host";
import { workspaceCheckout } from "./lib/workspace-checkout";

const npmCi = "npm ci --no-audit --no-fund -q";

// The firewall applies before `prepare` runs, so the checkout below already gets the GitHub credential on the way out.
// Eve rebuilds the snapshot whenever these options or this file change, which covers a new repository or workflow project.
export const environment = VercelSandbox.environment({
  networkPolicy: { allow },
  async prepare(sandbox) {
    // Commit as the token's owner: a Git-connected Vercel project blocks pushes from authors who are not team members.
    const who = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "gtm-agent" } });
    if (!who.ok) throw new Error(`GitHub rejected GTM_GITHUB_TOKEN (HTTP ${who.status})`);
    const { login, id } = (await who.json()) as { login: string; id: number };
    const result = await sandbox.run({
      command: [
        // The profile file is the one `bash -l` reads: .bash_profile, else .bash_login, else .profile.
        `p=$HOME/.bash_profile; [ -f $p ] || p=$HOME/.bash_login; [ -f $p ] || p=$HOME/.profile; printf '%s\\n' '${exports}' >> $p`,
        `git config --global user.name "${login}" && git config --global user.email "${id}+${login}@users.noreply.github.com" && git config --global init.defaultBranch main`,
        workspaceCheckout(`https://github.com/${repo}.git`, home),
        `if [ -f ${home}/workflows/package-lock.json ]; then (cd ${home}/workflows && ${npmCi}); fi`,
      ].join(" && "),
    });
    if (result.exitCode !== 0) throw new Error(`Sandbox setup failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  },
});

export default defineSandbox(async () => {
  const sandbox = await environment.open();
  // Freshen once per thread; never throws. A diverged local main is reset, because nothing local exists yet.
  await sandbox.run({
    command: `cd ${home} && git fetch -q && if git rev-parse -q --verify origin/main >/dev/null; then git rev-parse -q --verify HEAD >/dev/null && git merge --ff-only -q origin/main || git checkout -q -B main origin/main; fi || true; if [ -f workflows/package-lock.json ] && [ workflows/package-lock.json -nt workflows/node_modules/.package-lock.json ]; then (cd workflows && ${npmCi}); fi`,
  });
  return sandbox;
});
