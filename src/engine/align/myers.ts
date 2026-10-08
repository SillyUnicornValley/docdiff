// Myers O(ND) sequence diff over keys (docs/implementation/stage2-design.md §3.1 step 2).
// Common prefix/suffix are trimmed first; callers keep gaps small with anchors.

export type EditOp = { type: 'equal'; a: number; b: number } | { type: 'delete'; a: number } | { type: 'insert'; b: number };

/** Above this many edits the remaining gap is reported as delete-all + insert-all. */
const MAX_EDITS = 4000;

export function diffKeys(a: readonly string[], b: readonly string[]): EditOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;

  const ops: EditOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', a: i, b: i });
  ops.push(...middle(a, b, start, endA, start, endB));
  for (let i = 0; endA + i < a.length; i++) ops.push({ type: 'equal', a: endA + i, b: endB + i });
  return ops;
}

function middle(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number): EditOp[] {
  const n = a1 - a0;
  const m = b1 - b0;
  const all = (): EditOp[] => [
    ...Array.from({ length: n }, (_, i) => ({ type: 'delete' as const, a: a0 + i })),
    ...Array.from({ length: m }, (_, i) => ({ type: 'insert' as const, b: b0 + i })),
  ];
  if (n === 0 || m === 0) return all();

  const max = Math.min(n + m, MAX_EDITS);
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) x++, y++;
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return all();

  // Backtrack from (n, m).
  const rev: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) rev.push({ type: 'equal', a: a0 + --x, b: b0 + --y });
    if (x === prevX) rev.push({ type: 'insert', b: b0 + --y });
    else rev.push({ type: 'delete', a: a0 + --x });
  }
  while (x > 0 && y > 0) rev.push({ type: 'equal', a: a0 + --x, b: b0 + --y });
  return rev.reverse();
}
