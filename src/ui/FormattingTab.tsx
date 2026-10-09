// Formatting tab (decision 44): formatting differences of paired paragraphs and
// tables, shown only. Mock data has no formatting information: "not checked".

import { useMemo, useState } from 'react';
import type { DiffResult, FormatChange, FormatItem } from '../model/diff';
import { Tip } from './kit';

const SHOWN = 200;

/** “must”, “all” and 3 more */
export function placesText(places: string[] | undefined, max = 3): string {
  if (!places?.length) return '';
  const shown = places.slice(0, max).map((p) => `“${p}”`);
  return places.length > max ? `${shown.join(', ')} and ${places.length - max} more` : shown.join(', ');
}

export function FormatItemsTable({ items }: { items: FormatItem[] }) {
  return (
    <table className="fmt-items">
      <tbody>
        {items.map((i, k) => (
          <tr key={k}>
            <th>{i.property}</th>
            <td className="fmt-old">{i.old}</td>
            <td className="fmt-arrow">→</td>
            <td className="fmt-new">{i.new}</td>
            <td className="fmt-where">{placesText(i.places)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FormattingTab({ result, onShow, onBack }: { result: DiffResult; onShow: (c: FormatChange) => void; onBack: () => void }) {
  const changes = result.formatChanges;
  const [prop, setProp] = useState('');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of changes ?? []) for (const p of new Set(c.items.map((i) => i.property))) m.set(p, (m.get(p) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [changes]);

  if (!changes)
    return (
      <div className="formatting-notice">
        <h2>Formatting: not checked</h2>
        <p>This comparison has no formatting information (mock data). This does <b>not</b> mean the formatting is the same.</p>
        <button className="btn" onClick={onBack}>
          Back to content
        </button>
      </div>
    );

  const shown = changes.filter((c) => !prop || c.items.some((i) => i.property === prop));
  const paras = changes.filter((c) => c.target === 'paragraph').length;
  return (
    <div className="fmt-tab">
      <div className="fmt-head">
        <h2>Formatting differences</h2>
        <p>
          {changes.length ? (
            <>
              <b>{paras}</b> paragraph(s) and <b>{changes.length - paras}</b> table(s) are formatted differently.
            </>
          ) : (
            <>No formatting differences found in content that both files share.</>
          )}{' '}
          Shown only, not choosable: the export keeps the new file’s formatting.{' '}
          <Tip
            tip={
              <>
                Compared on paragraphs and tables that both files have (unchanged, edited or moved): paragraph style, alignment, indents, spacing, list type,
                bold, italic, underline, strikethrough, caps, font, size, colour, highlight, and table style. Character formatting is compared on the words both
                versions share — changed words are content differences. Added or removed content is not compared. Heading level changes are marked ⚑ in the
                Content view instead. Change formatting in Word after export if needed.
              </>
            }
          />
        </p>
        {counts.length > 1 && (
          <label className="fmt-filter">
            Property{' '}
            <select value={prop} onChange={(e) => setProp(e.target.value)}>
              <option value="">All ({changes.length})</option>
              {counts.map(([p, n]) => (
                <option key={p} value={p}>
                  {p} ({n})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ol className="fmt-list">
        {shown.slice(0, SHOWN).map((c) => (
          <li key={`${c.target}:${c.newId}`} className="fmt-card">
            <div className="fmt-card-head">
              <span className="fmt-kind">{c.target === 'table' ? 'Table' : 'Paragraph'}</span>
              <span className="fmt-text">{c.text || '(empty)'}</span>
              <button className="btn btn-small" onClick={() => onShow(c)}>
                Show in document
              </button>
            </div>
            <FormatItemsTable items={prop ? c.items.filter((i) => i.property === prop) : c.items} />
          </li>
        ))}
      </ol>
      {shown.length > SHOWN && <p className="muted">… and {shown.length - SHOWN} more. Filter by property to see them.</p>}
    </div>
  );
}
