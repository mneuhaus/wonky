// Changed source lines between two frozen source snapshots.
// Package: model-first-compare.
//
// Frozen signature:
//   changedSourceLines(beforeText, afterText) -> { changed: [line], added, removed }
//
// Line numbers are 1-based. `changed` and `added` are line numbers in the
// after text, `removed` line numbers in the before text. Within one hunk (a
// run of deleted and inserted lines between equal lines of a shortest edit
// script) the first min(deleted, inserted) inserted lines count as changed,
// extra inserted lines as added and extra deleted lines as removed.
//
// Added fields: `changedFrom` (index by index, the before line each changed
// line replaced), `beforeLines`, `afterLines` and `coarse`. When the edit
// distance exceeds `maxEdits`, the whole region between the common prefix
// and suffix is reported as one hunk and `coarse` is true: still exact about
// which region differs, not about the pairing inside it.
const DEFAULT_MAX_EDITS = 2000;

// A trailing newline ends the last line; it does not start an empty one.
export function splitLines(text) {
  const value = String(text ?? '');
  if (!value) return [];
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Myers' O(ND) shortest edit script over a[0..n) and b[0..m). Returns the
// list of operations ('=', '-', '+') or null when the distance exceeds max.
function editScript(a, b, max) {
  const n = a.length;
  const m = b.length;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] keeps v[-d-1 .. d+1] as it was before step d (memory O(D²)).
  const trace = [];
  const at = (d, k) => trace[d][k + d + 1];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const k = x - y;
    const down = k === -d || (k !== d && at(d, k - 1) < at(d, k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(d, previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      ops.push('=');
      x--;
      y--;
    }
    ops.push(down ? '+' : '-');
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    ops.push('=');
    x--;
    y--;
  }
  return ops.reverse();
}

// Adds one hunk's lines to the result (numbers are 0-based indices here).
function addHunk(result, deleted, inserted) {
  const paired = Math.min(deleted.length, inserted.length);
  result.changed.push(...inserted.slice(0, paired).map(index => index + 1));
  result.changedFrom.push(...deleted.slice(0, paired).map(index => index + 1));
  result.added.push(...inserted.slice(paired).map(index => index + 1));
  result.removed.push(...deleted.slice(paired).map(index => index + 1));
}

export function changedSourceLines(beforeText, afterText, { maxEdits = DEFAULT_MAX_EDITS } = {}) {
  const a = splitLines(beforeText);
  const b = splitLines(afterText);
  const result = {
    changed: [], changedFrom: [], added: [], removed: [],
    beforeLines: a.length, afterLines: b.length, coarse: false,
  };
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const range = (from, count) => Array.from({ length: count }, (_value, index) => from + index);
  const ops = editScript(middleA, middleB, maxEdits);
  if (!ops) {
    result.coarse = true;
    addHunk(result, range(start, middleA.length), range(start, middleB.length));
    return result;
  }
  let x = start;
  let y = start;
  let deleted = [];
  let inserted = [];
  const flush = () => {
    if (deleted.length || inserted.length) addHunk(result, deleted, inserted);
    deleted = [];
    inserted = [];
  };
  for (const op of ops) {
    if (op === '=') {
      flush();
      x++;
      y++;
    } else if (op === '-') deleted.push(x++);
    else inserted.push(y++);
  }
  flush();
  return result;
}

// "5, 7, 9-12": compact ranges for display.
export function lineRanges(lines) {
  const sorted = [...new Set(lines)].sort((left, right) => left - right);
  const parts = [];
  for (let index = 0; index < sorted.length; index++) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(end > index ? `${sorted[index]}-${sorted[end]}` : String(sorted[index]));
    index = end;
  }
  return parts.join(', ');
}
