import { useRef, useState } from 'react';
import { MOCK_PAIRS, type MockPair } from '../mock';
import { SAMPLE_PAIRS, type SamplePair } from '../samples';
import { APP_VERSION, BUILD_DATE } from '../version';

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
  if (ext === '.doc') return 'Word 97–2003 (.doc) files are not supported. Open the file in Word and save it as .docx first.';
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
            v{APP_VERSION} · prototype · built {BUILD_DATE}
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
          <b>Existing tracked changes:</b> both files are compared as if all existing tracked changes were accepted. Your original files are not modified. If the new file
          has pending tracked changes, they are accepted in the exported file — you will see how many before exporting.
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
          <summary>What docdiff v1 compares</summary>
          <ul>
            <li>
              <b>Compared:</b> body text and headings, list item text, table cell text and rows, superscript/subscript, hidden text, paragraph splits/joins and moves.
            </li>
            <li>
              <b>Detected only</b> (“may differ”): headers and footers, footnote text, hyperlink addresses, images, document properties.
            </li>
            <li>
              <b>Shown, not compared:</b> automatic list numbers, table of contents and fields (optional), images, text boxes, equations.
            </li>
            <li>
              <b>Not checked:</b> formatting (fonts, styles, spacing, heading levels…). Comments are not compared.
            </li>
          </ul>
        </details>
      </main>
    </div>
  );
}
