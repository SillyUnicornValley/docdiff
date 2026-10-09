// Other parts tab (decisions 45–46): footnotes, endnotes, headers, footers, text
// boxes, hyperlink addresses, pictures, document properties and comments,
// compared item by item. Shown only: nothing here is a choice, and the export
// keeps the new file's versions.

import type { ReactNode } from 'react';
import type { CommentPair, CommentStatus, DiffResult, OtherParts, PartPair, PartStatus, WordHunk } from '../model/diff';
import type { Block, NodeId } from '../model/document';
import { Tip } from './kit';
import { BlockView, type HlMap } from './render';

const PART_STATUS: Record<PartStatus, string> = { same: 'Same', changed: 'Changed', onlyOld: 'Only in old', onlyNew: 'Only in new' };
const COMMENT_STATUS: Record<CommentStatus, string> = {
  same: 'Same',
  textChanged: 'Comment text changed',
  anchorChanged: 'Commented text changed',
  onlyOld: 'Only in old',
  onlyNew: 'Only in new',
};

/** Number of items that differ, for the tab label. */
export function otherPartsCount(p: OtherParts | undefined): number {
  if (!p) return 0;
  const parts = [...p.footnotes, ...p.endnotes, ...p.headersFooters, ...p.textBoxes].filter((x) => x.status !== 'same').length;
  return parts + p.links.length + p.images.length + p.properties.length + p.comments.filter((c) => c.status !== 'same').length;
}

function hunkHighlights(hunks: WordHunk[], side: 'old' | 'new'): HlMap {
  const m: HlMap = new Map();
  for (const h of hunks)
    for (const s of h[side]) {
      const list = m.get(s.blockId) ?? [];
      list.push({ start: s.start, end: s.end, cls: side === 'old' ? 'w-del' : 'w-ins' });
      m.set(s.blockId, list);
    }
  return m;
}

function Blocks({ blocks, hl }: { blocks: Block[]; hl: HlMap }) {
  if (!blocks.length) return <div className="op-empty">—</div>;
  return (
    <>
      {blocks.map((b) => (
        <BlockView key={b.id} b={b} hl={hl} />
      ))}
    </>
  );
}

function Section({ title, total, differ, note, children }: { title: string; total: number; differ: number; note?: ReactNode; children: ReactNode }) {
  if (!total) return null;
  return (
    <section className="op-sec">
      <h3>
        {title}{' '}
        <span className="muted">
          · {differ ? `${differ} different` : 'all the same'}
          {differ && total > differ ? `, ${total - differ} the same` : ''}
        </span>
        {note && <Tip tip={note} />}
      </h3>
      {children}
    </section>
  );
}

function Parts({ title, items, note }: { title: string; items: PartPair[]; note?: ReactNode }) {
  const differ = items.filter((x) => x.status !== 'same');
  return (
    <Section title={title} total={items.length} differ={differ.length} note={note}>
      {differ.map((x, i) => (
        <div key={i} className="op-item">
          <div className="op-item-head">
            <b>{x.label}</b> <span className={`pill op-${x.status}`}>{PART_STATUS[x.status]}</span>
          </div>
          <div className="op-cols">
            <div className="op-col op-old">
              <div className="op-col-head">Old</div>
              <Blocks blocks={x.old} hl={hunkHighlights(x.hunks, 'old')} />
            </div>
            <div className="op-col op-new">
              <div className="op-col-head">New</div>
              <Blocks blocks={x.new} hl={hunkHighlights(x.hunks, 'new')} />
            </div>
          </div>
        </div>
      ))}
    </Section>
  );
}

function Change({ old, neu }: { old?: string; neu?: string }) {
  if (old === neu) return <span>{neu}</span>;
  return (
    <>
      <span className="fmt-old">{old ?? '—'}</span> <span className="fmt-arrow">→</span> <span className="fmt-new">{neu ?? '—'}</span>
    </>
  );
}

function CommentRow({ c, onShow }: { c: CommentPair; onShow: (id: NodeId) => void }) {
  const any = (c.new ?? c.old)!;
  const block = c.new?.blockId ?? c.old?.blockId;
  return (
    <li className="op-comment">
      <div className="op-item-head">
        <b>{any.author}</b> <span className={`pill op-${c.status === 'same' ? 'same' : c.status === 'onlyOld' ? 'onlyOld' : c.status === 'onlyNew' ? 'onlyNew' : 'changed'}`}>{COMMENT_STATUS[c.status]}</span>
        {block && (
          <button className="btn btn-small" onClick={() => onShow(block)}>
            Show in document
          </button>
        )}
      </div>
      <div>
        <span className="muted">Comment: </span>
        <Change old={c.old?.text} neu={c.new?.text} />
      </div>
      <div>
        <span className="muted">On: </span>
        <Change old={c.old ? `“${c.old.anchor || '(a point)'}”` : undefined} neu={c.new ? `“${c.new.anchor || '(a point)'}”` : undefined} />
      </div>
    </li>
  );
}

export function OtherPartsTab({ result, onShow, onBack }: { result: DiffResult; onShow: (id: NodeId) => void; onBack: () => void }) {
  const p = result.otherParts;
  if (!p)
    return (
      <div className="formatting-notice">
        <h2>Other parts: not compared</h2>
        <p>This comparison has no information about notes, headers, footers or comments (mock data). This does <b>not</b> mean they are the same.</p>
        <button className="btn" onClick={onBack}>
          Back to content
        </button>
      </div>
    );
  const count = otherPartsCount(p);
  const commentsDiffer = p.comments.filter((c) => c.status !== 'same');
  return (
    <div className="fmt-tab op-tab">
      <div className="fmt-head">
        <h2>Other parts</h2>
        <p>
          {count ? (
            <>
              <b>{count}</b> item(s) outside the main text differ.
            </>
          ) : (
            <>Notes, headers, footers, text boxes, link addresses, pictures, properties and comments are the same.</>
          )}{' '}
          Shown only, not choosable: the export keeps the new file’s versions. Change them in Word after export if needed.
        </p>
      </div>

      <Section
        title="Comments"
        total={p.comments.length}
        differ={commentsDiffer.length}
        note="Comments are paired by author and text, then by the text they are on. Comments of the old file are never carried into the export; comments of the new file are kept."
      >
        <ul className="op-comments">
          {commentsDiffer.map((c, i) => (
            <CommentRow key={i} c={c} onShow={onShow} />
          ))}
        </ul>
      </Section>
      <Parts title="Footnotes" items={p.footnotes} note="Footnotes are paired in the order they are referred to; an edited footnote is paired with the most similar one. Numbers are as shown in each file." />
      <Parts title="Endnotes" items={p.endnotes} />
      <Parts title="Headers and footers" items={p.headersFooters} note="By section and kind (first page, odd/default, even pages). Sections are paired by where they fall in the aligned text." />
      <Parts title="Text boxes" items={p.textBoxes} />
      <Section title="Hyperlink addresses" total={p.links.length} differ={p.links.length} note="Links in paragraphs that both files share, in order. The display text is compared in the Content view.">
        <ul className="op-list">
          {p.links.map((l, i) => (
            <li key={i}>
              <b>{l.text || '(link)'}</b>: <Change old={l.old} neu={l.new} />{' '}
              <button className="btn btn-small" onClick={() => onShow(l.newId)}>
                Show
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Pictures" total={p.images.length} differ={p.images.length} note="Pictures in paragraphs that both files share whose image data differs. docdiff does not show the pictures: open both files in Word to see them.">
        <ul className="op-list">
          {p.images.map((m, i) => (
            <li key={i}>
              <b>{m.label}</b> — picture differs · <span className="muted">{m.text}</span>{' '}
              <button className="btn btn-small" onClick={() => onShow(m.newId)}>
                Show
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Document properties" total={p.properties.length} differ={p.properties.length}>
        <table className="fmt-items">
          <tbody>
            {p.properties.map((x) => (
              <tr key={x.name}>
                <th>{x.name}</th>
                <td>
                  <Change old={x.old} neu={x.new} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
