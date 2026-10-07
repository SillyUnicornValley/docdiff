import { useEffect, useState } from 'react';
import { COMPARE_STEPS, compareFiles, DocxError } from '../engine';
import { mockForFiles, type MockPair } from '../mock';
import type { DiffResult } from '../model/diff';
import { invertResult } from '../model/invert';
import { applyChoices, emptyReview, type Review } from '../model/reviewOps';
import { readAutosave, writeAutosave } from './autosave';
import { CompareView } from './CompareView';
import { ConfirmDialog, Toasts, useToasts, type ConfirmRequest } from './kit';
import { SelectScreen, validateFile, type Slot } from './SelectScreen';

type Slots = { old?: Slot; new?: Slot };

const STEPS = COMPARE_STEPS;

export function App() {
  const [screen, setScreen] = useState<'select' | 'compare'>('select');
  const [slots, setSlots] = useState<Slots>({});
  const [loaded, setLoaded] = useState<{ key: string; result: DiffResult } | null>(null);
  const [review, setReviewRaw] = useState<Review>(emptyReview);
  const [dirty, setDirty] = useState(false);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState<{ step: number } | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const choiceCount = Object.keys(review.state.choices).length;
  const setReview = (r: Review) => {
    setReviewRaw(r);
    setDirty(true);
    if (loaded) writeAutosave(loaded.result, r.state.choices);
  };

  // Warn before leaving with unsaved choices (spec §8.3).
  useEffect(() => {
    if (!dirty || choiceCount === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, choiceCount]);

  /** Any change to the file pair invalidates choices: confirm first if there are any. */
  const guarded = (what: string, action: () => void) => {
    if (loaded && choiceCount > 0) {
      setConfirmReq({
        title: `${what}?`,
        message: (
          <p>
            You have <b>{choiceCount}</b> choice(s) for the current pair. {what} clears them. Save your review progress first if you may need it.
          </p>
        ),
        confirmLabel: `${what} and clear choices`,
        danger: true,
        onConfirm: () => {
          action();
          setLoaded(null);
          setReviewRaw(emptyReview());
          setDirty(false);
        },
      });
    } else {
      action();
      if (loaded) setLoaded(null);
    }
  };

  // Re-choosing a changed file with the same name gives a new key, so the pair is compared again.
  const fileKey = (x?: Slot) => `${x?.name}:${x?.file?.size ?? ''}:${x?.file?.lastModified ?? ''}`;
  const keyOf = (s: Slots) => `${fileKey(s.old)}|${fileKey(s.new)}`;

  const showResult = (key: string, result: DiffResult) => {
    setLoaded({ key, result });
    setReviewRaw(emptyReview());
    setDirty(false);
    setBusy(null);
    setScreen('compare');
    offerRestore(result);
  };

  const runCompare = (s: Slots, force = false) => {
    if (!s.old || !s.new) return;
    const key = keyOf(s);
    if (!force && loaded?.key === key) return setScreen('compare');
    setBusy({ step: 0 });
    if (s.old.file && s.new.file) {
      const [of, nf] = [s.old.file, s.new.file];
      (async () => {
        try {
          const [od, nd] = await Promise.all([of.arrayBuffer(), nf.arrayBuffer()]);
          const { result } = await compareFiles({ name: of.name, data: od }, { name: nf.name, data: nd }, (step) => setBusy({ step }));
          showResult(key, result);
        } catch (e) {
          setBusy(null);
          if (e instanceof DocxError) push(e.message);
          else {
            console.error(e);
            push(`Could not compare the files (unexpected error): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      })();
      return;
    }
    // Fake progress so the long-document progress UI can be judged.
    STEPS.forEach((_, i) => setTimeout(() => setBusy({ step: i }), i * 220));
    setTimeout(() => {
      const pair = mockForFiles(s.old!.name, s.new!.name);
      let result = pair.build();
      const swapped = /_new\./.test(s.old!.name) && /_old\./.test(s.new!.name);
      if (swapped) result = invertResult(result);
      showResult(key, result);
    }, STEPS.length * 220);
  };

  /** Offer the choices this browser autosaved for the same two files (decision A11). */
  const offerRestore = (result: DiffResult) => {
    const saved = readAutosave(result);
    if (!saved) return;
    const n = Object.keys(saved.choices).length;
    setConfirmReq({
      title: 'Restore your previous choices?',
      message: (
        <>
          <p>
            This browser kept <b>{n}</b> choice(s) for these two files, last saved {new Date(saved.savedAt).toLocaleString()}.
          </p>
          <p className="muted">If you start fresh, the kept choices are replaced as soon as you make a new choice. Browser storage is only a backup — use Progress → Save progress to keep your review safely.</p>
        </>
      ),
      confirmLabel: `Restore ${n} choice(s)`,
      cancelLabel: 'Start fresh',
      onConfirm: () => {
        setReviewRaw(applyChoices(emptyReview(), 'Restore autosaved choices', Object.entries(saved.choices).map(([diffId, to]) => ({ diffId, to }))));
        setDirty(true);
        push(`${n} choice(s) restored from this browser.`);
      },
    });
  };

  const onFile = (side: 'old' | 'new', f: File) =>
    guarded(slots[side] ? 'Replace file' : 'Change files', () => setSlots((s) => ({ ...s, [side]: { name: f.name, size: f.size, error: validateFile(f.name), file: f } })));

  const onSample = (p: MockPair) => {
    const s: Slots = { old: { name: p.oldName }, new: { name: p.newName } };
    guarded('Open another pair', () => {
      setSlots(s);
      setTimeout(() => runCompare(s, true), 0);
    });
  };

  return (
    <>
      {screen === 'select' || !loaded ? (
        <SelectScreen
          slots={slots}
          onFile={onFile}
          onClear={(side) => guarded('Remove file', () => setSlots((s) => ({ ...s, [side]: undefined })))}
          onSwap={() => guarded('Swap files', () => setSlots((s) => ({ old: s.new, new: s.old })))}
          onCompare={() => runCompare(slots)}
          onSample={onSample}
          canResume={!!loaded && loaded.key === keyOf(slots)}
        />
      ) : (
        <CompareView
          key={loaded.key}
          result={loaded.result}
          review={review}
          setReview={setReview}
          dirty={dirty && choiceCount > 0}
          markClean={() => setDirty(false)}
          onChangeFiles={() => setScreen('select')}
          toast={push}
          confirm={setConfirmReq}
        />
      )}
      {busy && (
        <div className="modal-backdrop">
          <div className="modal busy" role="status">
            <h2>Comparing…</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s} className={i < busy.step ? 'done' : i === busy.step ? 'now' : ''}>
                  {i < busy.step ? '✓' : i === busy.step ? '…' : '·'} {s}
                </li>
              ))}
            </ol>
            <div className="progress-bar">
              <div style={{ width: `${((busy.step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>
        </div>
      )}
      {confirmReq && <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}
