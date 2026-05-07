import assert from "node:assert/strict";
import test from "node:test";
import { PieceTableBuffer } from "../src/text-buffer.js";

test("piece table inserts, deletes, replaces, and preserves text", () => {
  const buffer = new PieceTableBuffer("hello world");

  buffer.insert(5, ", brave");
  assert.equal(buffer.toString(), "hello, brave world");
  assert.equal(buffer.length, "hello, brave world".length);

  const deleted = buffer.delete(5, 7);
  assert.equal(deleted, ", brave");
  assert.equal(buffer.toString(), "hello world");

  const replaced = buffer.replace(6, 5, "there");
  assert.equal(replaced, "world");
  assert.equal(buffer.toString(), "hello there");
  assert.ok(buffer.pieces().every((piece) => piece.length > 0));
});

test("piece table maps offsets and positions across newline styles", () => {
  const buffer = new PieceTableBuffer("a\r\nbc\nd");

  assert.deepEqual(buffer.offsetToPosition(0), { line: 0, column: 0 });
  assert.deepEqual(buffer.offsetToPosition(3), { line: 1, column: 0 });
  assert.deepEqual(buffer.offsetToPosition(6), { line: 2, column: 0 });
  assert.equal(buffer.positionToOffset(1, 1), 4);
  assert.equal(buffer.positionToOffset(99, 99), buffer.length);
  assert.equal(buffer.lineCount(), 3);
  assert.equal(buffer.lineText(1), "bc");
});

test("piece table rejects out-of-range edits", () => {
  const buffer = new PieceTableBuffer("abc");

  assert.throws(() => buffer.insert(4, "!"), RangeError);
  assert.throws(() => buffer.delete(2, 2), RangeError);
  assert.throws(() => buffer.replace(-1, 1, "x"), RangeError);
});

test("piece table matches a string model through deterministic edit fuzzing", () => {
  const buffer = new PieceTableBuffer("seed");
  let model = "seed";
  let seed = 12345;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };

  for (let step = 0; step < 250; step += 1) {
    const operation = Math.floor(random() * 3);
    const offset = Math.floor(random() * (model.length + 1));
    const length = Math.floor(random() * (model.length - offset + 1));
    const text = String.fromCharCode(97 + Math.floor(random() * 26));

    if (operation === 0) {
      buffer.insert(offset, text);
      model = `${model.slice(0, offset)}${text}${model.slice(offset)}`;
    } else if (operation === 1) {
      assert.equal(buffer.delete(offset, length), model.slice(offset, offset + length));
      model = `${model.slice(0, offset)}${model.slice(offset + length)}`;
    } else {
      assert.equal(buffer.replace(offset, length, text), model.slice(offset, offset + length));
      model = `${model.slice(0, offset)}${text}${model.slice(offset + length)}`;
    }

    assert.equal(buffer.toString(), model);
    assert.ok(buffer.pieces().every((piece) => piece.length > 0));
  }
});
