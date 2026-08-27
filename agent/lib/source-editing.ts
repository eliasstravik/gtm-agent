export type ExactSourceEdit = {
  readonly oldText: string;
  readonly newText: string;
};

export function applyExactSourceEdits(
  content: string,
  edits: readonly ExactSourceEdit[],
): string {
  if (edits.length === 0) {
    throw new Error("edits must contain at least one replacement.");
  }

  const matches = edits.map((edit, index) => {
    if (edit.oldText.length === 0) {
      throw new Error(`edits[${index}].oldText must not be empty.`);
    }
    const start = content.indexOf(edit.oldText);
    if (start === -1) {
      throw new Error(
        `edits[${index}].oldText was not found. Read the current file and try again.`,
      );
    }
    if (content.indexOf(edit.oldText, start + 1) !== -1) {
      throw new Error(
        `edits[${index}].oldText occurs more than once. Include enough surrounding text to make it unique.`,
      );
    }
    return { ...edit, end: start + edit.oldText.length, index, start };
  });

  const ordered = [...matches].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      throw new Error(
        `edits[${previous.index}] and edits[${current.index}] overlap. Merge them into one edit.`,
      );
    }
  }

  return [...ordered]
    .reverse()
    .reduce(
      (result, edit) =>
        result.slice(0, edit.start) + edit.newText + result.slice(edit.end),
      content,
    );
}
