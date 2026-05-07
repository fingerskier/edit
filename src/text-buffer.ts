export type PieceSource = "original" | "add";

export type Piece = {
  source: PieceSource;
  start: number;
  length: number;
};

export type TextPosition = {
  line: number;
  column: number;
};

export class PieceTableBuffer {
  private readonly original: string;
  private add = "";
  private pieceList: Piece[];

  constructor(text = "") {
    this.original = text;
    this.pieceList = text.length > 0 ? [{ source: "original", start: 0, length: text.length }] : [];
  }

  get length(): number {
    return this.pieceList.reduce((total, piece) => total + piece.length, 0);
  }

  pieces(): Piece[] {
    return this.pieceList.map((piece) => ({ ...piece }));
  }

  toString(): string {
    return this.pieceList.map((piece) => this.pieceText(piece)).join("");
  }

  slice(offset = 0, length = this.length - offset): string {
    this.assertRange(offset, length);
    if (length === 0) {
      return "";
    }

    const end = offset + length;
    let documentOffset = 0;
    let result = "";

    for (const piece of this.pieceList) {
      const pieceStart = documentOffset;
      const pieceEnd = pieceStart + piece.length;
      if (pieceEnd > offset && pieceStart < end) {
        const overlapStart = Math.max(offset, pieceStart);
        const overlapEnd = Math.min(end, pieceEnd);
        const sourceStart = piece.start + overlapStart - pieceStart;
        result += this.sourceText(piece.source).slice(sourceStart, sourceStart + overlapEnd - overlapStart);
      }
      documentOffset = pieceEnd;
      if (documentOffset >= end) {
        break;
      }
    }

    return result;
  }

  insert(offset: number, text: string): void {
    this.assertOffset(offset);
    if (text.length === 0) {
      return;
    }

    const addStart = this.add.length;
    this.add += text;
    const inserted: Piece = { source: "add", start: addStart, length: text.length };
    const { pieceIndex, innerOffset } = this.findPiecePosition(offset);

    if (pieceIndex >= this.pieceList.length) {
      this.pieceList.push(inserted);
    } else {
      const piece = this.pieceList[pieceIndex];
      if (innerOffset === 0) {
        this.pieceList.splice(pieceIndex, 0, inserted);
      } else if (innerOffset === piece.length) {
        this.pieceList.splice(pieceIndex + 1, 0, inserted);
      } else {
        const before: Piece = { source: piece.source, start: piece.start, length: innerOffset };
        const after: Piece = {
          source: piece.source,
          start: piece.start + innerOffset,
          length: piece.length - innerOffset
        };
        this.pieceList.splice(pieceIndex, 1, before, inserted, after);
      }
    }

    this.normalizePieces();
  }

  delete(offset: number, length: number): string {
    this.assertRange(offset, length);
    if (length === 0) {
      return "";
    }

    const deleted = this.slice(offset, length);
    const deleteStart = offset;
    const deleteEnd = offset + length;
    const nextPieces: Piece[] = [];
    let documentOffset = 0;

    for (const piece of this.pieceList) {
      const pieceStart = documentOffset;
      const pieceEnd = pieceStart + piece.length;

      if (pieceEnd <= deleteStart || pieceStart >= deleteEnd) {
        nextPieces.push(piece);
      } else {
        const beforeLength = Math.max(0, deleteStart - pieceStart);
        const afterLength = Math.max(0, pieceEnd - deleteEnd);

        if (beforeLength > 0) {
          nextPieces.push({ source: piece.source, start: piece.start, length: beforeLength });
        }
        if (afterLength > 0) {
          nextPieces.push({
            source: piece.source,
            start: piece.start + piece.length - afterLength,
            length: afterLength
          });
        }
      }

      documentOffset = pieceEnd;
    }

    this.pieceList = nextPieces;
    this.normalizePieces();
    return deleted;
  }

  replace(offset: number, length: number, text: string): string {
    const deleted = this.delete(offset, length);
    this.insert(offset, text);
    return deleted;
  }

  offsetToPosition(offset: number): TextPosition {
    this.assertOffset(offset);
    const text = this.toString();
    let line = 0;
    let column = 0;

    for (let index = 0; index < offset; index += 1) {
      const char = text[index];
      if (char === "\r") {
        if (text[index + 1] === "\n" && index + 1 < offset) {
          index += 1;
        }
        line += 1;
        column = 0;
      } else if (char === "\n") {
        line += 1;
        column = 0;
      } else {
        column += 1;
      }
    }

    return { line, column };
  }

  positionToOffset(line: number, column: number): number {
    const targetLine = Math.max(0, Math.floor(line));
    const targetColumn = Math.max(0, Math.floor(column));
    const text = this.toString();
    let currentLine = 0;
    let currentColumn = 0;

    if (targetLine === 0 && targetColumn === 0) {
      return 0;
    }

    for (let index = 0; index < text.length; index += 1) {
      if (currentLine === targetLine && currentColumn === targetColumn) {
        return index;
      }

      const char = text[index];
      if (char === "\r" || char === "\n") {
        if (currentLine === targetLine) {
          return index;
        }
        if (char === "\r" && text[index + 1] === "\n") {
          index += 1;
        }
        currentLine += 1;
        currentColumn = 0;
        if (currentLine === targetLine && targetColumn === 0) {
          return index + 1;
        }
      } else {
        currentColumn += 1;
      }
    }

    return text.length;
  }

  lineCount(): number {
    return splitLines(this.toString()).length;
  }

  lineText(line: number): string {
    const lines = splitLines(this.toString());
    const index = Math.max(0, Math.floor(line));
    return lines[index] ?? "";
  }

  private sourceText(source: PieceSource): string {
    return source === "original" ? this.original : this.add;
  }

  private pieceText(piece: Piece): string {
    return this.sourceText(piece.source).slice(piece.start, piece.start + piece.length);
  }

  private findPiecePosition(offset: number): { pieceIndex: number; innerOffset: number } {
    let documentOffset = 0;
    for (let pieceIndex = 0; pieceIndex < this.pieceList.length; pieceIndex += 1) {
      const piece = this.pieceList[pieceIndex];
      const nextOffset = documentOffset + piece.length;
      if (offset < nextOffset) {
        return { pieceIndex, innerOffset: offset - documentOffset };
      }
      if (offset === nextOffset) {
        return { pieceIndex, innerOffset: piece.length };
      }
      documentOffset = nextOffset;
    }
    return { pieceIndex: this.pieceList.length, innerOffset: 0 };
  }

  private normalizePieces(): void {
    const normalized: Piece[] = [];
    for (const piece of this.pieceList) {
      if (piece.length <= 0) {
        continue;
      }

      const previous = normalized[normalized.length - 1];
      if (previous && previous.source === piece.source && previous.start + previous.length === piece.start) {
        previous.length += piece.length;
      } else {
        normalized.push({ ...piece });
      }
    }
    this.pieceList = normalized;
  }

  private assertOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw new RangeError(`Offset out of range: ${offset}`);
    }
  }

  private assertRange(offset: number, length: number): void {
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`Length out of range: ${length}`);
    }
    this.assertOffset(offset);
    if (offset + length > this.length) {
      throw new RangeError(`Range out of bounds: ${offset} + ${length}`);
    }
  }
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}
