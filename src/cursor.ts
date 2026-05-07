export type Selection = {
  anchor: number;
  focus: number;
};

export type SelectionEdit = {
  offset: number;
  deletedLength: number;
  insertedLength: number;
};

export function selectionStart(selection: Selection): number {
  return Math.min(selection.anchor, selection.focus);
}

export function selectionEnd(selection: Selection): number {
  return Math.max(selection.anchor, selection.focus);
}

export function normalizeSelections(selections: Selection[], documentLength: number): Selection[] {
  const max = Math.max(0, Math.floor(documentLength));
  const ranges = selections
    .map((selection) => {
      const start = clamp(selectionStart(selection), 0, max);
      const end = clamp(selectionEnd(selection), 0, max);
      return { anchor: start, focus: end };
    })
    .sort((a, b) => selectionStart(a) - selectionStart(b) || selectionEnd(a) - selectionEnd(b));

  const normalized: Selection[] = [];
  for (const range of ranges) {
    const previous = normalized[normalized.length - 1];
    if (!previous) {
      normalized.push(range);
      continue;
    }

    if (selectionStart(range) <= selectionEnd(previous)) {
      previous.anchor = selectionStart(previous);
      previous.focus = Math.max(selectionEnd(previous), selectionEnd(range));
    } else {
      normalized.push(range);
    }
  }

  return normalized;
}

export function transformSelectionsAfterEdit(selections: Selection[], edit: SelectionEdit, documentLength: number): Selection[] {
  const deletedLength = Math.max(0, Math.floor(edit.deletedLength));
  const insertedLength = Math.max(0, Math.floor(edit.insertedLength));
  const offset = clamp(edit.offset, 0, Math.max(0, Math.floor(documentLength)));
  const editEnd = offset + deletedLength;
  const delta = insertedLength - deletedLength;
  const nextLength = Math.max(0, Math.floor(documentLength) + delta);

  return normalizeSelections(
    selections.map((selection) => ({
      anchor: transformPoint(selection.anchor, offset, editEnd, insertedLength, delta),
      focus: transformPoint(selection.focus, offset, editEnd, insertedLength, delta)
    })),
    nextLength
  );
}

function transformPoint(point: number, offset: number, editEnd: number, insertedLength: number, delta: number): number {
  if (point <= offset) {
    return point;
  }
  if (point <= editEnd) {
    return offset + insertedLength;
  }
  return point + delta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
