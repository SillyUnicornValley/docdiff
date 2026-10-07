import { describe, expect, it } from 'vitest';
import { diffKeys, type EditOp } from './myers';

/** Rebuild b from a and the ops, checking every op is consistent. */
function apply(a: string[], b: string[], ops: EditOp[]) {
  const out: string[] = [];
  let ia = 0;
  let ib = 0;
  for (const op of ops) {
    if (op.type === 'equal') {
      expect([op.a, op.b]).toEqual([ia++, ib++]);
      expect(a[op.a]).toBe(b[op.b]);
      out.push(a[op.a]);
    } else if (op.type === 'delete') expect(op.a).toBe(ia++);
    else {
      expect(op.b).toBe(ib++);
      out.push(b[op.b]);
    }
  }
  expect([ia, ib]).toEqual([a.length, b.length]);
  return out;
}

describe('diffKeys', () => {
  it('finds a minimal edit script', () => {
    const a = 'ABCABBA'.split('');
    const b = 'CBABAC'.split('');
    const ops = diffKeys(a, b);
    expect(apply(a, b, ops)).toEqual(b);
    expect(ops.filter((o) => o.type !== 'equal').length).toBe(5);
  });
  it('handles empty sides and identical input', () => {
    expect(diffKeys([], ['x'])).toEqual([{ type: 'insert', b: 0 }]);
    expect(diffKeys(['x'], [])).toEqual([{ type: 'delete', a: 0 }]);
    expect(diffKeys(['x', 'y'], ['x', 'y']).every((o) => o.type === 'equal')).toBe(true);
  });
  it('is consistent on random input', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcde'[Math.floor(rnd() * 5)]);
      const b = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcde'[Math.floor(rnd() * 5)]);
      expect(apply(a, b, diffKeys(a, b))).toEqual(b);
    }
  });
});
