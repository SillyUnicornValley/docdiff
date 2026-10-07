import { useState } from 'react';
import type { DiffResult } from '../model/diff';
import type { Review } from '../model/reviewOps';
import { Modal, yyyymmdd } from './kit';

export function ExportDialog({ result, review, onClose, onExported }: { result: DiffResult; review: Review; onClose: () => void; onExported: (fileName: string) => void }) {
  const reviewable = result.order.filter((id) => !result.differences[id].informational);
  const unreviewed = reviewable.filter((id) => !review.state.choices[id]).length;
  const usedOld = reviewable.filter((id) => review.state.choices[id] === 'old').length;
  const pending = result.scope.pendingRevisionsInNew;
  const fileName = `${result.new.fileName.replace(/\.docx$/i, '')}_merged_${yyyymmdd()}.docx`;
  const [mode, setMode] = useState<'clean' | 'tracked'>('clean');
  return (
    <Modal
      title="Export merged document"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onExported(fileName)}>
            Export {fileName}
          </button>
        </>
      }
    >
      <div className="export">
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
          <li>Base file: “{result.new.fileName}” with existing revisions accepted. Its styles, page setup and comments are kept.</li>
          <li>Word will ask to update fields when the file is opened, so the table of contents and cross-references refresh.</li>
          <li>After export, docdiff re-reads the file and warns if it does not match the final-result preview.</li>
        </ul>

        <div className="export-name">
          File name: <code>{fileName}</code>
          <div className="muted">Saved as a new file. Your uploaded files are never overwritten.</div>
        </div>
        <div className="proto-note">Prototype: export is mocked — no .docx is written.</div>
      </div>
    </Modal>
  );
}
