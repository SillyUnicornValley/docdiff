import { useRef, useState } from 'react';
import { MOCK_PAIRS, type MockPair } from '../mock';
import { SAMPLE_PAIRS, type SamplePair } from '../samples';
import { APP_VERSION, BUILD_DATE } from '../version';
import { Tip } from './kit';

export interface Slot {
  name: string;
  size?: number;
  error?: string;
  /** The chosen file. Absent for sample pairs, which load mock data. */
  file?: File;
}

/** ?mock in the URL shows the hand-written mock pairs instead of the built-in test documents. */
const MOCK_MODE = new URLSearchParams(location.search).has('mock');

export function validateFile(name: string): string | undefined {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  if (ext === '.docx') return undefined;
  if (ext === '.doc') return 'Word 97–2003 (.doc) files are not supported. Open the file in Word, choose File › Save As › Word Document (*.docx), then select the saved .docx here.';
  if (['.docm', '.dotx', '.dotm'].includes(ext)) return `${ext} files are not supported. Save the file as a standard .docx in Word first.`;
  return 'This is not a Word .docx file.';
}

const fmtSize = (n?: number) => (n === undefined ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function SlotCard({ role, slot, onFile, onClear }: { role: 'old' | 'new'; slot?: Slot; onFile: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`slot slot-${role}${over ? ' over' : ''}${slot?.error ? ' has-error' : ''}${slot && !slot.error ? ' filled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <div className="slot-role">{role === 'old' ? '− Old version (left)' : '+ New version (right)'}</div>
      {slot ? (
        <div className="slot-file">
          <div className="slot-name">📄 {slot.name}</div>
          {slot.size !== undefined && <div className="muted">{fmtSize(slot.size)}</div>}
          {slot.error && <div className="slot-error">⚠ {slot.error}</div>}
          <div className="slot-actions">
            <button className="btn btn-small" onClick={() => input.current?.click()}>
              Replace…
            </button>
            <button className="btn btn-small" onClick={onClear}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="slot-empty">
          <div>Drop a .docx file here</div>
          <button className="btn" onClick={() => input.current?.click()}>
            Choose file…
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".docx,.doc,.docm,.dotx,.dotm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

export function SelectScreen({
  slots,
  onFile,
  onClear,
  onSwap,
  onCompare,
  onSample,
  canResume,
}: {
  slots: { old?: Slot; new?: Slot };
  onFile: (side: 'old' | 'new', f: File) => void;
  onClear: (side: 'old' | 'new') => void;
  onSwap: () => void;
  onCompare: () => void;
  onSample: (p: SamplePair | MockPair) => void;
  canResume: boolean;
}) {
  const ready = slots.old && slots.new && !slots.old.error && !slots.new.error;
  return (
    <div className="app select-screen">
      <header className="topbar">
        <div className="brand">
          docdiff{' '}
          <span className="ver">
            v{APP_VERSION} · pre-release · built {BUILD_DATE}
          </span>
        </div>
      </header>
      <main className="select">
        <h1>Compare two Word documents</h1>
        <p className="lead">Choose the old and the new version. Your files are processed in this browser and never leave your computer.</p>
        <div className="slots">
          <SlotCard role="old" slot={slots.old} onFile={(f) => onFile('old', f)} onClear={() => onClear('old')} />
          <button className="swap" onClick={onSwap} disabled={!slots.old && !slots.new} title="Swap old and new">
            ⇄<span>Swap</span>
          </button>
          <SlotCard role="new" slot={slots.new} onFile={(f) => onFile('new', f)} onClear={() => onClear('new')} />
        </div>
        <div className="notice">
          <Tip tip="Both files are compared as if all existing tracked changes were accepted. Your original files are not modified. If the new file has pending tracked changes, they are accepted in the exported file — you will see how many before exporting.">
            <b>Existing tracked changes</b> are accepted before comparing.
          </Tip>
        </div>
        <div className="compare-row">
          <button className="btn btn-primary btn-big" disabled={!ready} onClick={onCompare}>
            {canResume ? 'Back to comparison' : 'Compare'}
          </button>
        </div>

        <h2>{MOCK_MODE ? 'Sample pairs (mock data, for UI work)' : 'Sample pairs (test documents)'}</h2>
        <div className="samples">
          {(MOCK_MODE ? MOCK_PAIRS : SAMPLE_PAIRS).map((p) => (
            <button key={p.id} className="sample" onClick={() => onSample(p)}>
              <div className="sample-title">{p.title}</div>
              <div className="sample-desc">{p.description}</div>
            </button>
          ))}
        </div>

        <details className="scope-summary">
          <summary>What docdiff compares</summary>
          <ul>
            <li>
              <Tip tip="Body text and headings, list item text, table cells and rows, superscript and subscript, hidden text, hyperlink text, and paragraph splits, joins and moves. Changes to table columns or merged cells are chosen for the whole table.">
                <b>Compared, you choose old or new:</b> the main text and tables.
              </Tip>
            </li>
            <li>
              <Tip tip="Heading level changes are marked ⚑ and automatic numbering differences №. You cannot choose them: the export keeps the new levels, and Word recalculates the numbers.">
                <b>Flagged only:</b> heading levels ⚑ and automatic numbering №.
              </Tip>
            </li>
            <li>
              <Tip tip="Footnotes and endnotes, headers and footers, text boxes and comments are compared item by item. Changed hyperlink addresses, pictures and document properties are listed. You cannot choose them: the export keeps the new version, and old comments are not added.">
                <b>Other parts tab, shown only:</b> notes, headers and footers, text boxes, comments, link addresses, pictures, properties.
              </Tip>
            </li>
            <li>
              <Tip tip="The table of contents and date or page fields are shown and can be compared from View options. Charts, shapes, SmartArt, equations and embedded objects appear as placeholders.">
                <b>Shown, not compared:</b> fields and the table of contents, charts, shapes, equations.
              </Tip>
            </li>
            <li>
              <Tip tip="Fonts, sizes, colours, bold and italic, spacing, alignment, styles, list and table styles, and page setup. A change that is only formatting shows no difference; the export keeps the new file's formatting. Use Word's own Compare if formatting matters.">
                <b>Not checked:</b> formatting and page setup.
              </Tip>
            </li>
          </ul>
        </details>
      </main>
    </div>
  );
}
