import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSelections, selectionEnd, selectionStart, transformSelectionsAfterEdit } from "../src/cursor.js";

test("selection helpers normalize direction", () => {
  const selection = { anchor: 8, focus: 3 };

  assert.equal(selectionStart(selection), 3);
  assert.equal(selectionEnd(selection), 8);
});

test("normalizeSelections clamps, sorts, deduplicates, and merges overlaps", () => {
  assert.deepEqual(
    normalizeSelections(
      [
        { anchor: 20, focus: 20 },
        { anchor: 5, focus: 2 },
        { anchor: 3, focus: 6 },
        { anchor: 10, focus: 10 },
        { anchor: 10, focus: 10 }
      ],
      10
    ),
    [
      { anchor: 2, focus: 6 },
      { anchor: 10, focus: 10 }
    ]
  );
});

test("transformSelectionsAfterEdit preserves anchors and focus across edits", () => {
  assert.deepEqual(
    transformSelectionsAfterEdit(
      [
        { anchor: 1, focus: 3 },
        { anchor: 8, focus: 8 }
      ],
      { offset: 2, deletedLength: 3, insertedLength: 1 },
      10
    ),
    [
      { anchor: 1, focus: 3 },
      { anchor: 6, focus: 6 }
    ]
  );
});
