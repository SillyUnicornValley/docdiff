import type { DiffResult, ScopeStatus } from '../model/diff';
import type { StructureChange, StructureHints } from '../model/hints';
import { SCOPE_STATUS_LABEL } from './labels';

const ORDER: ScopeStatus[] = ['compared', 'flagged', 'detectedOnly', 'shownNotCompared', 'notSupported'];

const SHOWN = 50;

function ChangeList({ items, mark }: { items: StructureChange[]; mark: string }) {
  if (!items.length) return null;
  return (
    <ul className="level-list">
      {items.slice(0, SHOWN).map((c) => (
        <li key={c.newId}>
          {mark} <b>{c.oldLabel} → {c.newLabel}</b> — “{c.text.length > 60 ? `${c.text.slice(0, 60)}…` : c.text || '(empty)'}”
        </li>
      ))}
      {items.length > SHOWN && <li className="muted">… and {items.length - SHOWN} more</li>}
    </ul>
  );
}

export function ScopePanel({ result, hints, onClose }: { result: DiffResult; hints: StructureHints; onClose: () => void }) {
  const s = result.scope;
  return (
    <aside className="drawer" aria-label="Check scope">
      <div className="drawer-head">
        <h2>Check scope</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <p className="muted">Anything not marked “Compared” must not be read as “no difference”.</p>

        {s.unsupportedRevisions.length > 0 && (
          <section className="scope-sec warn-box">
            <h3>⚠ Table cell tracked changes</h3>
            <ul>
              {s.unsupportedRevisions.map((u, i) => (
                <li key={i}>
                  <b>{u.type}</b> in the {u.side} file — {u.location}. Accepted and compared; the table's columns may not line up, so results in this table may be inaccurate.
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="scope-sec">
          <h3>Formatting</h3>
          {s.formatting === 'flagged' ? (
            <div className="scope-row">
              <span className="pill pill-flagged">Flagged only</span> Paragraph style, alignment, indents, spacing, list type, bold/italic/underline, font, size,
              colour, highlight and table style of content both files share: {result.formatChanges?.length ?? 0} difference(s), listed in the Formatting tab
              and marked Aa in the text. Not choosable; the export keeps the new formatting.
            </div>
          ) : (
            <div className="scope-row">
              <span className="pill pill-notchecked">Not checked</span> Fonts, sizes, colours, bold/italic, spacing, styles, list types, table formatting.
            </div>
          )}
          <div className="scope-row">
            <span className="pill pill-flagged">Flagged only</span> Heading levels: changes are marked ⚑ in the text but cannot be chosen; the export keeps the new file's level.
          </div>
          <ChangeList items={hints.levels} mark="⚑" />
          <div className="scope-row">
            <span className="pill pill-flagged">Flagged only</span> Automatic numbering: numbers that differ are marked № in the text (an inserted item shifts all later numbers). Not choosable; Word recalculates numbers and the export keeps the new numbering.
          </div>
          <ChangeList items={hints.numbering} mark="№" />
        </section>

        {s.sectionHints.length > 0 && (
          <section className="scope-sec">
            <h3>Headers and footers by section{result.otherParts ? ' (contents compared in Other parts)' : ' (detected only)'}</h3>
            <table className="scope-table hf-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Part</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {s.sectionHints.map((h, i) => (
                  <tr key={i}>
                    <td>
                      {h.oldSection === h.newSection ? h.newSection : `old ${h.oldSection ?? '–'} / new ${h.newSection ?? '–'}`}
                    </td>
                    <td>
                      {h.part === 'header' ? 'Header' : 'Footer'}
                      {h.variant === 'first' ? ' (first page)' : h.variant === 'even' ? ' (even pages)' : ''}
                    </td>
                    <td>
                      <span className={`pill pill-${h.result === 'same' ? 'same' : 'mayDiffer'}`}>
                        {h.result === 'same' ? 'Same' : h.result === 'mayDiffer' ? 'May differ' : h.result === 'onlyNew' ? 'Section only in new' : 'Section only in old'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Sections whose header or footer may differ are also marked in the document view (§ Section n).</p>
          </section>
        )}

        {s.fingerprints.length > 0 && (
          <section className="scope-sec">
            <h3>Other parts outside the body{result.otherParts ? ' (compared item by item in the Other parts tab)' : ' (detected only)'}</h3>
            <ul className="fp-list">
              {s.fingerprints.map((f) => (
                <li key={f.part} className={`fp-${f.result}`}>
                  <span className={`pill pill-${f.result}`}>{f.result === 'mayDiffer' ? 'May differ' : f.result === 'same' ? 'Same' : 'Absent'}</span> {f.message ?? f.part}
                </li>
              ))}
            </ul>
          </section>
        )}

        {ORDER.map((st) => {
          const items = s.items.filter((i) => i.status === st);
          if (!items.length) return null;
          return (
            <section className="scope-sec" key={st}>
              <h3>
                <span className={`pill pill-${st}`}>{SCOPE_STATUS_LABEL[st]}</span>
              </h3>
              <table className="scope-table">
                <thead>
                  <tr>
                    <th>Element</th>
                    <th>Old</th>
                    <th>New</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.element}>
                      <td>{i.element}</td>
                      <td>{i.oldCount}</td>
                      <td>{i.newCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

        <section className="scope-sec">
          <h3>Existing tracked changes</h3>
          <p>Both files were compared as if all existing tracked changes were accepted. The uploaded files are not modified.</p>
          {s.pendingRevisionsInNew > 0 && (
            <p>
              The new file contains <b>{s.pendingRevisionsInNew}</b> pending tracked change(s). They will be accepted in the exported file.
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
