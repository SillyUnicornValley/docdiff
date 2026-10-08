import { useState } from 'react';
import type { ExportResult } from '../engine';
import type { DiffResult } from '../model/diff';
import type { Review } from '../model/reviewOps';
import { downloadBlob, Modal, yyyymmdd } from './kit';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Phase = { type: 'idle' } | { type: 'working' } | { type: 'mismatch'; out: ExportResult } | { type: 'error'; message: string };

export function ExportDialog({
  result,
  review,
  onClose,
  onExported,
  exportDocx,
}: {
  result: DiffResult;
  review: Review;
  onClose: () => void;
  onExported: (message: string, tone?: 'info' | 'warn') => void;
  /** Absent for mock data: the export is simulated. */
  exportDocx?: () => Promise<ExportResult>;
}) {
  const reviewable = result.order.filter((id) => !result.differences[id].informational);
  const unreviewed = reviewable.filter((id) => !review.state.choices[id]).length;
  const usedOld = reviewable.filter((id) => review.state.choices[id] === 'old').length;
  const pending = result.scope.pendingRevisionsInNew;
  const fileName = `${result.new.fileName.replace(/\.docx$/i, '')}_merged_${yyyymmdd()}.docx`;
  const [mode, setMode] = useState<'clean' | 'tracked'>('clean');
  const [phase, setPhase] = useState<Phase>({ type: 'idle' });

  const save = (out: ExportResult) => void downloadBlob(fileName, new Blob([out.bytes], { type: DOCX_MIME }));

  const run = async () => {
    if (!exportDocx) {
      onExported(`Mock data: no file written. A real export would save "${fileName}".`);
      return;
    }
    setPhase({ type: 'working' });
    // Let the dialog paint "Writing…" before the main thread is busy.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const out = await exportDocx();
      if (!out.check.ok) return setPhase({ type: 'mismatch', out });
      save(out);
      onExported(`Exported “${fileName}”. Self-check passed: the file matches the final-result preview.`);
    } catch (e) {
      console.error(e);
      setPhase({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const footer =
    phase.type === 'mismatch' ? (
      <>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          onClick={() => {
            save(phase.out);
            onExported(`Exported “${fileName}” although it does not fully match the preview. Check it in Word.`, 'warn');
          }}
        >
          Download anyway
        </button>
      </>
    ) : (
      <>
        <button className="btn" onClick={onClose} disabled={phase.type === 'working'}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={run} disabled={phase.type === 'working'}>
          {phase.type === 'working' ? 'Writing and checking…' : phase.type === 'error' ? 'Try again' : `Export ${fileName}`}
        </button>
      </>
    );

  return (
    <Modal title="Export merged document" onClose={phase.type === 'working' ? () => {} : onClose} footer={footer}>
      <div className="export">
        {phase.type === 'mismatch' ? (
          <MismatchReport out={phase.out} />
        ) : (
          <>
            <fieldset>
              <legend>Format</legend>
              <label>
                <input type="radio" checked={mode === 'clean'} onChange={() => setMode('clean')} /> <b>Clean</b> — final content, no tracked changes. Comments in the new file are kept.
              </label>
              <label className="disabled">
                <input type="radio" disabled checked={mode === 'tracked'} onChange={() => setMode('tracked')} /> Tracked changes (new → final) — <i>planned for a later version</i>
              </label>
            </fieldset>

            <ul className="export-checks">
              <li className={unreviewed ? 'warn' : 'ok'}>
                {unreviewed ? (
                  <>
                    ⚠ <b>{unreviewed}</b> of {reviewable.length} difference(s) are unreviewed. They will use the <b>new</b> version.
                  </>
                ) : (
                  <>✓ All {reviewable.length} differences reviewed.</>
                )}
              </li>
              <li>
                {usedOld} difference(s) set to <b>Use old</b>; everything else comes from the new file.
              </li>
              {pending > 0 && (
                <li className="warn">
                  ⚠ The new file contains <b>{pending}</b> pending tracked change(s). They will be <b>accepted</b> in the exported file.
                </li>
              )}
              <li>Base file: “{result.new.fileName}” with existing revisions accepted. Its styles, page setup, headers, footers and comments are kept.</li>
              <li>Text brought back from the old file takes the formatting of the new file around it.</li>
              <li>Word will ask to update fields when the file is opened, so the table of contents and cross-references refresh.</li>
              <li>After writing, docdiff reads the file again and checks that it matches the final-result preview.</li>
            </ul>

            <div className="export-name">
              File name: <code>{fileName}</code>
              <div className="muted">Saved as a new file in your downloads. Your uploaded files are never changed.</div>
            </div>
            {phase.type === 'error' && <div className="export-error">⚠ Export failed: {phase.message}</div>}
            {!exportDocx && <div className="proto-note">Mock data (?mock): export is simulated — no .docx is written.</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

function MismatchReport({ out }: { out: ExportResult }) {
  const c = out.check;
  return (
    <div className="export-mismatch">
      <p className="warn">
        ⚠ The exported file does <b>not fully match</b> the final-result preview
        {c.mismatches > 0 && (
          <>
            : <b>{c.mismatches}</b> of {c.compared} block(s) differ
          </>
        )}
        . The file was not saved yet.
      </p>
      {c.problems.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {c.examples.length > 0 && (
        <ul className="mismatch-examples">
          {c.examples.map((e, i) => (
            <li key={i}>
              {e.expected !== undefined ? (
                <>
                  <span className="tag">Preview only</span> {e.expected}
                </>
              ) : (
                <>
                  <span className="tag">File only</span> {e.actual}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">You can download it anyway and check these places in Word, or cancel and change the choices nearby. Please report this case so it can be fixed.</p>
    </div>
  );
}
