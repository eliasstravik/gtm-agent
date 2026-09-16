const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** A template rebuild may inherit its checkout. Update it without discarding local work. */
export function workspaceCheckout(url: string, directory: string): string {
  const target = directory.startsWith("$HOME/")
    ? `"$HOME"/${quote(directory.slice(6))}`
    : quote(directory);
  const git = `git -C ${target}`;
  return `(if [ -d ${target}/.git ]; then
    if [ "$(${git} config --get remote.origin.url)" != ${quote(url)} ]; then
      echo 'Existing workspace has a different origin' >&2; exit 1;
    fi
    ${git} fetch -q origin &&
    if ${git} rev-parse -q --verify origin/main >/dev/null; then
      if ${git} rev-parse -q --verify HEAD >/dev/null; then
        ${git} merge --ff-only -q origin/main;
      else
        ${git} checkout -q -b main origin/main;
      fi
    fi
  else
    git clone -q ${quote(url)} ${target};
  fi)`;
}
