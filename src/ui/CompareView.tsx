import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffId, DiffResult, Difference, NormCategory } from '../model/diff';
import type { Choice, ReviewStatus } from '../model/review';
import { applyChoices, makeProgressFile, parseProgressFile, redo, statusOf, undo, type Review } from '../model/reviewOps';
import { APP_VERSION } from '../version';
import { ExportDialog } from './ExportDialog';
import { finalRowContent } from './finalView';
import { downloadText, Popover, yyyymmdd, type ConfirmRequest } from './kit';
import { CATEGORY_LABEL, KIND_LABEL, STATUS_LABEL } from './labels';
import { BlockView, highlightsFor, SideSegments, sideClass, TableFragment, useView, ViewContext, type ViewCtx } from './render';
import { buildRows, foldRows, isHidden, makeIndexes, rowDiffIds, type Row, type Visibility } from './rows';
import { ScopePanel } from './ScopePanel';

export interface ViewOptions {
  syncScroll: boolean;
  collapseUnchanged: boolean;
  diffsOnly: boolean;
  hiddenCategories: Set<NormCategory>;
  compareToc: boolean;
  compareFields: boolean;
  preview: 'off' | 'column' | 'only';
}

export const defaultViewOptions = (): ViewOptions => ({
  syncScroll: true,
  collapseUnchanged: false,
  diffsOnly: false,
  hiddenCategories: new Set(),
  compareToc: false,
  compareFields: false,
  preview: 'off',
});

interface Actions {
  choose: (id: DiffId, c: Choice | undefined) => void;
  select: (id: DiffId) => void;
  jump: (id: DiffId, part?: 'from' | 'to') => void;
  expand: (runId: string) => void;
  /** Leave "preview only" and show this difference in the compare view. */
  reviewInCompare: (id: DiffId) => void;
  number: (id: DiffId) => string;
}
const ActionsContext = createContext<Actions>(null as unknown as Actions);

// ---------------------------------------------------------------------------

export function CompareView({
  result,
  review,
  setReview,
  dirty,
  markClean,
  onChangeFiles,
  toast,
  confirm,
}: {
  result: DiffResult;
  review: Review;
  setReview: (r: Review) => void;
  dirty: boolean;
  markClean: () => void;
  onChangeFiles: () => void;
  toast: (text: string, tone?: 'info' | 'warn' | 'error') => void;
  confirm: (r: ConfirmRequest) => void;
}) {
  const [opts, setOpts] = useState<ViewOptions>(defaultViewOptions);
  const [currentId, setCurrentId] = useState<DiffId | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<'scope' | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [tab, setTab] = useState<'content' | 'formatting'>('content');
  const loadRef = useRef<HTMLInputElement>(null);

  const ix = useMemo(() => makeIndexes(result), [result]);
  const allRows = useMemo(() => buildRows(result, ix), [result, ix]);
  const vis: Visibility = useMemo(
    () => ({ hiddenCategories: opts.hiddenCategories, compareToc: opts.compareToc, compareFields: opts.compareFields }),
    [opts.hiddenCategories, opts.compareToc, opts.compareFields],
  );
  // Reviewable differences are numbered 1..N; info-only ones (TOC, fields) i1, i2…
  const numberOf = useMemo(() => {
    const m = new Map<DiffId, string>();
    let n = 0;
    let k = 0;
    for (const id of result.order) m.set(id, result.differences[id].informational ? `i${++k}` : String(++n));
    return m;
  }, [result]);

  const reviewable = useMemo(() => result.order.filter((id) => !result.differences[id].informational), [result]);
  const navOrder = useMemo(() => result.order.filter((id) => !isHidden(result.differences[id], vis)), [result, vis]);
  const reviewedCount = reviewable.filter((id) => review.state.choices[id]).length;
  const hiddenCount = reviewable.filter((id) => isHidden(result.differences[id], vis)).length;

  const changed = useCallback((row: Row) => rowDiffIds(row).some((id) => !isHidden(result.differences[id], vis)), [result, vis]);
  const rows = useMemo(
    () => foldRows(allRows, changed, { collapseUnchanged: opts.collapseUnchanged, diffsOnly: opts.diffsOnly, expanded }),
    [allRows, changed, opts.collapseUnchanged, opts.diffsOnly, expanded],
  );
  const rowIndexOf = useMemo(() => {
    const m = new Map<DiffId, number[]>();
    rows.forEach((r, i) => {
      for (const id of rowDiffIds(r)) m.set(id, [...(m.get(id) ?? []), i]);
    });
    return m;
  }, [rows]);

  // Scroll plumbing: the active list registers a scroller.
  const scroller = useRef<(index: number, align?: 'center' | 'start') => void>(() => {});
  const topRowKey = useRef<string | undefined>(undefined);

  const scrollToDiff = useCallback(
    (id: DiffId, part?: 'from' | 'to') => {
      const idxs = rowIndexOf.get(id);
      if (!idxs?.length) return;
      let i = idxs[0];
      if (part) i = idxs.find((k) => rows[k].kind === 'diff' && (rows[k] as Extract<Row, { kind: 'diff' }>).part === part) ?? i;
      scroller.current(i, 'center');
    },
    [rowIndexOf, rows],
  );

  const goTo = useCallback(
    (id: DiffId | undefined, part?: 'from' | 'to') => {
      if (!id) return;
      setCurrentId(id);
      scrollToDiff(id, part);
    },
    [scrollToDiff],
  );

  const choose = useCallback(
    (id: DiffId, c: Choice | undefined) => {
      const d = result.differences[id];
      if (c === 'old' && !d.useOld.available) return;
      const label = c ? `Use ${c} on #${numberOf.get(id)}` : `Clear #${numberOf.get(id)}`;
      setReview(applyChoices(review, label, [{ diffId: id, to: c }]));
      setCurrentId(id);
    },
    [result, review, setReview, numberOf],
  );

  const curPos = currentId ? navOrder.indexOf(currentId) : -1;
  const next = () => goTo(navOrder[Math.min(navOrder.length - 1, curPos + 1)] ?? navOrder[0]);
  const prev = () => goTo(navOrder[Math.max(0, curPos - 1)] ?? navOrder[0]);
  const nextUnreviewed = () => {
    const pending = navOrder.filter((id) => !result.differences[id].informational && !review.state.choices[id]);
    if (!pending.length) return toast('No unreviewed differences left in view.');
    goTo(pending.find((id) => navOrder.indexOf(id) > curPos) ?? pending[0]);
  };
  const doUndo = () => {
    const e = review.history.past.at(-1);
    if (!e) return;
    setReview(undo(review));
    toast(`Undone: ${e.label}`);
    if (e.changes.length === 1) goTo(e.changes[0].diffId);
  };
  const doRedo = () => {
    const e = review.history.future[0];
    if (!e) return;
    setReview(redo(review));
    toast(`Redone: ${e.label}`);
    if (e.changes.length === 1) goTo(e.changes[0].diffId);
  };

  // Keyboard shortcuts
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, textarea, select, .modal')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? doRedo() : doUndo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
    } else if (mod || e.altKey) return;
    else if (e.key === 'j') next();
    else if (e.key === 'k') prev();
    else if (e.key === 'u') nextUnreviewed();
    else if (e.key === '1' && currentId) choose(currentId, 'old');
    else if (e.key === '2' && currentId) choose(currentId, 'new');
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Batch actions
  const section = currentId ? result.sections.find((s) => s.id === result.differences[currentId].sectionId) : undefined;
  const batchSection = (c: Choice) => {
    if (!section) return;
    const ids = reviewable.filter((id) => result.differences[id].sectionId === section.id);
    const allowed = ids.filter((id) => c === 'new' || result.differences[id].useOld.available);
    setReview(applyChoices(review, `Section "${section.title}" → ${c}`, allowed.map((id) => ({ diffId: id, to: c }))));
    const skipped = ids.length - allowed.length;
    toast(`${allowed.length} difference(s) in "${section.title}" set to Use ${c}.${skipped ? ` ${skipped} skipped: "Use old" unavailable.` : ''}`);
  };
  const batchUnreviewedNew = () => {
    const ids = reviewable.filter((id) => !review.state.choices[id]);
    setReview(applyChoices(review, 'All unreviewed → new', ids.map((id) => ({ diffId: id, to: 'new' as const }))));
    toast(`${ids.length} unreviewed difference(s) set to Use new.`);
  };

  // Progress save / load
  const saveProgress = () => {
    downloadText(`${result.new.fileName.replace(/\.docx$/i, '')}_review_${yyyymmdd()}.json`, JSON.stringify(makeProgressFile(result, review, APP_VERSION), null, 2));
    markClean();
    toast('Review progress saved. Load it later with the same two files.');
  };
  const loadProgress = async (file: File) => {
    const res = parseProgressFile(await file.text(), result);
    if (!res.ok) return toast(res.message, 'error');
    const apply = () => {
      const changes = reviewable.map((id) => ({ diffId: id, to: res.choices[id] }));
      setReview(applyChoices(review, `Load progress (${file.name})`, changes));
      markClean();
      toast(`Progress loaded: ${Object.keys(res.choices).length} choice(s) restored.${res.skipped ? ` ${res.skipped} skipped.` : ''}`);
    };
    if (Object.keys(review.state.choices).length)
      confirm({
        title: 'Replace current choices?',
        message: <p>Loading this progress file replaces your current {Object.keys(review.state.choices).length} choice(s). You can undo this.</p>,
        confirmLabel: 'Load progress',
        onConfirm: apply,
      });
    else apply();
  };

  // Keep the current difference in view when the layout changes.
  const layoutKey = `${opts.syncScroll}|${opts.preview}|${opts.diffsOnly}|${opts.collapseUnchanged}`;
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    if (currentId) requestAnimationFrame(() => scrollToDiff(currentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const ctx: ViewCtx = { result, ix, vis, choices: review.state.choices, currentId, onSelectDiff: setCurrentId };
  const actions: Actions = {
    choose,
    select: setCurrentId,
    jump: (id, part) => goTo(id, part),
    expand: (runId) => setExpanded((s) => new Set(s).add(runId)),
    reviewInCompare: (id) => {
      setCurrentId(id);
      setOpts((o) => ({ ...o, preview: 'off' }));
    },
    number: (id) => numberOf.get(id) ?? '?',
  };
  const set = <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const unsupported = result.scope.unsupportedRevisions.length;
  const mayDiffer = result.scope.fingerprints.filter((f) => f.result === 'mayDiffer').length;

  return (
    <ViewContext.Provider value={ctx}>
      <ActionsContext.Provider value={actions}>
        <div className="app compare">
          <header className="topbar">
            <div className="brand">
              docdiff <span className="ver">v{APP_VERSION} · prototype</span>
            </div>
            <div className="files" title="Old (left) → New (right)">
              <span className="file old">− {result.old.fileName}</span>
              <span className="arrow">→</span>
              <span className="file new">+ {result.new.fileName}</span>
              <button className="btn btn-small" onClick={onChangeFiles}>
                Change files
              </button>
            </div>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'content'} className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>
                Content
              </button>
              <button role="tab" aria-selected={tab === 'formatting'} className={tab === 'formatting' ? 'active' : ''} onClick={() => setTab('formatting')}>
                Formatting <span className="muted">· not checked</span>
              </button>
            </div>
            <div className="spacer" />
            <div className="progress" title={`${reviewedCount} of ${reviewable.length} differences have a choice. Unreviewed differences use the new version.`}>
              <div className="progress-text">
                Reviewed <b>{reviewedCount}</b> / {reviewable.length}
                {hiddenCount > 0 && <span className="muted"> · {hiddenCount} hidden</span>}
              </div>
              <div className="progress-bar">
                <div style={{ width: `${reviewable.length ? (100 * reviewedCount) / reviewable.length : 100}%` }} />
              </div>
            </div>
            <Popover label="Progress" align="right" title="Save or load review progress">
              {(close) => (
                <div className="menu">
                  <button
                    onClick={() => {
                      close();
                      saveProgress();
                    }}
                  >
                    Save progress… <span className="muted">(JSON with both file fingerprints)</span>
                  </button>
                  <button
                    onClick={() => {
                      close();
                      loadRef.current?.click();
                    }}
                  >
                    Load progress…
                  </button>
                  <div className="menu-note">{dirty ? '● You have unsaved choices.' : 'All choices saved.'}</div>
                </div>
              )}
            </Popover>
            <input
              ref={loadRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) loadProgress(f);
              }}
            />
            <button className={`btn${panel === 'scope' ? ' active' : ''}`} onClick={() => setPanel(panel === 'scope' ? null : 'scope')} title="What was compared and what was not">
              Check scope
              {unsupported + mayDiffer > 0 && <span className="badge warn">{unsupported + mayDiffer}</span>}
            </button>
            <button className="btn btn-primary" onClick={() => setShowExport(true)}>
              Export…
            </button>
          </header>

          <div className="infobar">
            <span>ⓘ Compared as if all existing tracked changes were accepted. Original files are not modified.</span>
            {unsupported > 0 && (
              <button className="link warn" onClick={() => setPanel('scope')}>
                ⚠ {unsupported} unsupported revision type(s) — results nearby may be inaccurate
              </button>
            )}
            {mayDiffer > 0 && (
              <button className="link" onClick={() => setPanel('scope')}>
                {mayDiffer} not-compared part(s) may differ
              </button>
            )}
          </div>

          {tab === 'formatting' ? (
            <div className="formatting-notice">
              <h2>Formatting: not checked</h2>
              <p>Formatting comparison (fonts, sizes, colours, bold/italic, spacing, styles, heading levels, list types, table formatting) is not available in v1.</p>
              <p>
                This does <b>not</b> mean the formatting is the same. The Content view shows both documents in one reading style; heading levels and list types are shown as they
                are in each file but are not compared.
              </p>
              <button className="btn" onClick={() => setTab('content')}>
                Back to content
              </button>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <div className="nav">
                  <button className="btn" onClick={prev} disabled={!navOrder.length} title="Previous difference (K)">
                    ↑ Prev
                  </button>
                  <button className="btn" onClick={next} disabled={!navOrder.length} title="Next difference (J)">
                    ↓ Next
                  </button>
                  <button className="btn" onClick={nextUnreviewed} title="Next unreviewed difference (U)">
                    ⇣ Next unreviewed
                  </button>
                  <span className="pos">
                    {curPos >= 0 ? (
                      <>
                        Difference <b>{curPos + 1}</b> of {navOrder.length}
                      </>
                    ) : (
                      <>{navOrder.length} differences</>
                    )}
                  </span>
                </div>
                <Popover label="Batch" title="Apply a choice to many differences at once (one undo step)">
                  {(close) => (
                    <div className="menu">
                      <div className="menu-title">{section ? `Section: ${section.title}` : 'Section: select a difference first'}</div>
                      <button
                        disabled={!section}
                        onClick={() => {
                          close();
                          batchSection('new');
                        }}
                      >
                        All in this section → Use new
                      </button>
                      <button
                        disabled={!section}
                        onClick={() => {
                          close();
                          batchSection('old');
                        }}
                      >
                        All in this section → Use old
                      </button>
                      <div className="menu-sep" />
                      <button
                        onClick={() => {
                          close();
                          batchUnreviewedNew();
                        }}
                      >
                        All unreviewed → Use new
                      </button>
                    </div>
                  )}
                </Popover>
                <button className="btn" onClick={doUndo} disabled={!review.history.past.length} title={review.history.past.length ? `Undo: ${review.history.past.at(-1)!.label} (Ctrl+Z)` : 'Nothing to undo'}>
                  ↶ Undo
                </button>
                <button className="btn" onClick={doRedo} disabled={!review.history.future.length} title={review.history.future.length ? `Redo: ${review.history.future[0].label} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
                  ↷ Redo
                </button>
                <ViewMenu opts={opts} set={set} result={result} />
                <div className="seg" role="group" aria-label="Final result preview">
                  <span className="seg-label">Final result:</span>
                  {(['off', 'column', 'only'] as const).map((p) => (
                    <button key={p} className={opts.preview === p ? 'active' : ''} onClick={() => set('preview', p)} aria-pressed={opts.preview === p}>
                      {p === 'off' ? 'Hidden' : p === 'column' ? 'Third column' : 'Preview only'}
                    </button>
                  ))}
                </div>
                <div className="legend" aria-label="Legend">
                  <span className="lg lg-del">− old / removed</span>
                  <span className="lg lg-ins">+ new / added</span>
                  <span className="lg lg-mov">⇄ moved</span>
                </div>
              </div>

              {opts.preview === 'only' ? (
                <FinalOnlyList rows={rows} scrollerRef={scroller} />
              ) : opts.syncScroll ? (
                <AlignedList rows={rows} showFinal={opts.preview === 'column'} scrollerRef={scroller} topRowKey={topRowKey} />
              ) : (
                <SidePanes rows={rows} scrollerRef={scroller} topRowKey={topRowKey} />
              )}
            </>
          )}

          {panel === 'scope' && <ScopePanel result={result} onClose={() => setPanel(null)} />}
          {showExport && (
            <ExportDialog
              result={result}
              review={review}
              onClose={() => setShowExport(false)}
              onExported={(name) => {
                markClean();
                setShowExport(false);
                toast(`Prototype: no file written. Real export would save "${name}".`);
              }}
            />
          )}
        </div>
      </ActionsContext.Provider>
    </ViewContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// View options menu
// ---------------------------------------------------------------------------

function ViewMenu({ opts, set, result }: { opts: ViewOptions; set: <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => void; result: DiffResult }) {
  const counts = useMemo(() => {
    const c = new Map<NormCategory, number>();
    for (const d of Object.values(result.differences)) {
      const cats = new Set(d.wordHunks.map((h) => h.category).filter(Boolean) as NormCategory[]);
      if (d.category) cats.add(d.category);
      for (const k of cats) c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [result]);
  const hasInfo = (s: 'toc' | 'fields') => Object.values(result.differences).some((d) => d.informational === s);
  const toggleCat = (c: NormCategory) => {
    const s = new Set(opts.hiddenCategories);
    if (s.has(c)) s.delete(c);
    else s.add(c);
    set('hiddenCategories', s);
  };
  return (
    <Popover label="View" title="View options">
      {() => (
        <div className="menu view-menu">
          <div className="menu-title">Layout</div>
          <label>
            <input type="checkbox" checked={opts.syncScroll} onChange={(e) => set('syncScroll', e.target.checked)} /> Sync scroll by aligned content
          </label>
          <label>
            <input type="checkbox" checked={opts.collapseUnchanged} onChange={(e) => set('collapseUnchanged', e.target.checked)} /> Collapse unchanged content
          </label>
          <label>
            <input type="checkbox" checked={opts.diffsOnly} onChange={(e) => set('diffsOnly', e.target.checked)} /> Differences only
          </label>
          <div className="menu-sep" />
          <div className="menu-title">Show differences in</div>
          {(Object.keys(CATEGORY_LABEL) as NormCategory[]).map((c) => (
            <label key={c}>
              <input type="checkbox" checked={!opts.hiddenCategories.has(c)} onChange={() => toggleCat(c)} /> {CATEGORY_LABEL[c]}
              <span className="muted"> ({counts.get(c) ?? 0})</span>
            </label>
          ))}
          <div className="menu-note">Hidden differences still go into the final result as "new".</div>
          <div className="menu-sep" />
          <div className="menu-title">Optional comparisons (info only, no choice)</div>
          <label>
            <input type="checkbox" checked={opts.compareToc} onChange={(e) => set('compareToc', e.target.checked)} /> Compare table of contents
            {!hasInfo('toc') && <span className="muted"> (none in this pair)</span>}
          </label>
          <label>
            <input type="checkbox" checked={opts.compareFields} onChange={(e) => set('compareFields', e.target.checked)} /> Compare date, page and other fields
            {!hasInfo('fields') && <span className="muted"> (none in this pair)</span>}
          </label>
          <label className="disabled" title="Planned for a later version">
            <input type="checkbox" disabled /> Compare automatic numbering <span className="muted">— not available in v1</span>
          </label>
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Difference controls (gutter)
// ---------------------------------------------------------------------------

function DiffControls({ d, part, compact }: { d: Difference; part?: 'whole' | 'from' | 'to'; compact?: boolean }) {
  const { choices, currentId } = useView();
  const a = useContext(ActionsContext);
  const status: ReviewStatus | 'info' = d.informational ? 'info' : ((choices[d.id] as Choice | undefined) ?? 'unreviewed');
  const k = KIND_LABEL[d.kind];
  if (compact) {
    return (
      <div
        className={`gctl compact status-${status}${currentId === d.id ? ' current' : ''}`}
        title={`#${a.number(d.id)} ${k.label} · ${status === 'info' ? 'info only' : STATUS_LABEL[status]}`}
        onClick={(e) => {
          e.stopPropagation();
          a.select(d.id);
        }}
      >
        <span className="g-num">#{a.number(d.id)}</span>
        <span className={`g-icon kind-${d.kind}`} aria-label={k.label}>
          {k.icon}
        </span>
        {status === 'info' ? (
          <span className="g-info">info</span>
        ) : (
          <>
            <button
              className={`choice choice-old${status === 'old' ? ' on' : ''}`}
              disabled={!d.useOld.available}
              title={d.useOld.available ? 'Use old (1)' : d.useOld.message}
              aria-pressed={status === 'old'}
              onClick={(e) => {
                e.stopPropagation();
                a.choose(d.id, 'old');
              }}
            >
              Old
            </button>
            <button
              className={`choice choice-new${status === 'new' ? ' on' : ''}`}
              title="Use new (2)"
              aria-pressed={status === 'new'}
              onClick={(e) => {
                e.stopPropagation();
                a.choose(d.id, 'new');
              }}
            >
              New
            </button>
          </>
        )}
      </div>
    );
  }
  return (
    <div
      className={`gctl status-${status}${currentId === d.id ? ' current' : ''}${compact ? ' compact' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        a.select(d.id);
      }}
    >
      <div className="g-kind">
        <span className="g-num">#{a.number(d.id)}</span>
        <span className={`g-icon kind-${d.kind}`} aria-hidden>
          {k.icon}
        </span>
        <span>{k.label}</span>
      </div>
      {d.category && !compact && <div className="g-cat">{CATEGORY_LABEL[d.category]}</div>}
      {d.informational ? (
        <div className="g-info" title="Optional comparison: shown for information only. The final result always keeps the new version.">
          Info only · not choosable
        </div>
      ) : (
        <>
          <div className={`g-status st-${status}`}>{status === 'unreviewed' ? STATUS_LABEL.unreviewed : status === 'old' ? '✓ Using old' : '✓ Using new'}</div>
          <div className="g-btns">
            <button
              className={`choice choice-old${status === 'old' ? ' on' : ''}`}
              disabled={!d.useOld.available}
              title={d.useOld.available ? 'Use the old version here (1)' : d.useOld.message}
              aria-pressed={status === 'old'}
              onClick={(e) => {
                e.stopPropagation();
                a.choose(d.id, 'old');
              }}
            >
              Use old
            </button>
            <button
              className={`choice choice-new${status === 'new' ? ' on' : ''}`}
              title="Use the new version here (2)"
              aria-pressed={status === 'new'}
              onClick={(e) => {
                e.stopPropagation();
                a.choose(d.id, 'new');
              }}
            >
              Use new
            </button>
          </div>
          {!d.useOld.available && (
            <div className="g-why" title={d.useOld.message}>
              ⓘ Use old unavailable: {d.useOld.message.split('.')[0].replace(/^Contains /, '').toLowerCase()}
            </div>
          )}
          {status !== 'unreviewed' && !compact && (
            <button
              className="link g-clear"
              onClick={(e) => {
                e.stopPropagation();
                a.choose(d.id, undefined);
              }}
            >
              Mark unreviewed
            </button>
          )}
        </>
      )}
      {d.kind === 'moved' && part && part !== 'whole' && (
        <button
          className="link g-jump"
          onClick={(e) => {
            e.stopPropagation();
            a.jump(d.id, part === 'from' ? 'to' : 'from');
          }}
        >
          {part === 'from' ? 'Original location · go to new ↓' : 'New location · go to original ↑'}
        </button>
      )}
      {d.kind === 'tableStructure' && !compact && <div className="g-note">Table structure changed — v1 offers a whole-table choice only.</div>}
      {d.summary && !compact && <div className="g-summary">{d.summary}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

function Spacer({ label }: { label?: string }) {
  return <div className="spacer-fill">{label && <span>{label}</span>}</div>;
}

function sideContent(row: Row, side: 'old' | 'new', ctx: ViewCtx): { node: ReactNode; cls: string } {
  if (row.kind === 'gap') return { node: null, cls: '' };
  if (row.kind === 'equal') return { node: <BlockView b={row[side]} counterpart={row[side === 'old' ? 'new' : 'old']} />, cls: '' };
  if (row.kind === 'diff') {
    const d = ctx.result.differences[row.diffId];
    const blocks = row[side];
    if (isHidden(d, ctx.vis)) {
      return { node: blocks.map((b) => <BlockView key={b.id} b={b} />), cls: 'muted-diff' };
    }
    if (!blocks.length) {
      const label =
        d.kind === 'moved' ? (side === 'old' ? '⇄ new location of moved text' : '⇄ original location of moved text') : side === 'old' ? 'not in old' : 'not in new';
      return { node: <Spacer label={label} />, cls: `spacer ${sideClass(d, side, ctx)}` };
    }
    const hl = highlightsFor(d, side, ctx.vis);
    return { node: blocks.map((b) => <BlockView key={b.id} b={b} hl={hl} />), cls: sideClass(d, side, ctx) };
  }
  // table row
  const seg = row.seg;
  const t = side === 'old' ? row.oldTable : row.newTable;
  const trs = row[side];
  if (seg.type === 'diff') {
    const d = ctx.result.differences[seg.diffId];
    if (!trs.length) return { node: <Spacer label={side === 'old' ? 'row not in old' : 'row not in new'} />, cls: `spacer ${sideClass(d, side, ctx)}` };
    return {
      node: <TableFragment t={t} rows={trs} first={row.first} cellContent={(_r, c) => c.blocks.map((b) => <BlockView key={b.id} b={b} />)} />,
      cls: sideClass(d, side, ctx),
    };
  }
  return {
    node: (
      <TableFragment
        t={t}
        rows={trs}
        first={row.first}
        cellContent={(_r, c, ci) => (seg.type === 'rowPair' ? <SideSegments segs={seg.cells[ci].segments} side={side} /> : c.blocks.map((b) => <BlockView key={b.id} b={b} />))}
      />
    ),
    cls: '',
  };
}

function GapRow({ row }: { row: Extract<Row, { kind: 'gap' }> }) {
  const a = useContext(ActionsContext);
  return (
    <div className="row row-gap">
      <button className="gap-btn" onClick={() => a.expand(row.runId)}>
        ⋯ {row.count} unchanged {row.count === 1 ? 'block' : 'blocks'} hidden · Show
      </button>
    </div>
  );
}

function AlignedRowView({ row, showFinal }: { row: Row; showFinal: boolean }) {
  const ctx = useView();
  if (row.kind === 'gap') return <GapRow row={row} />;
  const o = sideContent(row, 'old', ctx);
  const n = sideContent(row, 'new', ctx);
  const ids = rowDiffIds(row).filter((id) => !isHidden(ctx.result.differences[id], ctx.vis));
  const isCurrent = ctx.currentId !== undefined && ids.includes(ctx.currentId);
  const select = ids.length === 1 ? () => ctx.onSelectDiff?.(ids[0]) : undefined;
  const fin = showFinal ? finalRowContent(row, ctx) : null;
  return (
    <div className={`row${ids.length ? ' row-chg' : ''}${isCurrent ? ' row-current' : ''}${showFinal ? ' with-final' : ''}`} onClick={select}>
      <div className={`cell old ${o.cls}`}>{o.node}</div>
      <div className="gutter">
        {ids.map((id) => (
          <DiffControls key={id} d={ctx.result.differences[id]} part={row.kind === 'diff' ? row.part : undefined} compact={row.kind === 'tableRow'} />
        ))}
      </div>
      <div className={`cell new ${n.cls}`}>{n.node}</div>
      {showFinal && <div className="cell final">{fin ?? <div className="final-empty">— nothing in final —</div>}</div>}
    </div>
  );
}

function estimate(row: Row) {
  if (row.kind === 'gap') return 36;
  if (row.kind === 'tableRow') return 34;
  if (row.kind === 'diff') return 120;
  return 48;
}

type ScrollerRef = React.MutableRefObject<(index: number, align?: 'center' | 'start') => void>;

function useList(rows: Row[], scrollerRef: ScrollerRef, topRowKey?: React.MutableRefObject<string | undefined>, register = true) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => estimate(rows[i]),
    getItemKey: (i) => rows[i].key,
    overscan: 6,
  });
  if (register)
    scrollerRef.current = (i, align = 'center') => {
      v.scrollToIndex(i, { align });
      // Re-run once sizes are measured, so variable-height rows land correctly.
      setTimeout(() => v.scrollToIndex(i, { align }), 60);
    };
  // Restore position by content (row key) when this list mounts.
  useLayoutEffect(() => {
    const k = topRowKey?.current;
    if (!k) return;
    const i = rows.findIndex((r) => r.key === k);
    if (i > 0) v.scrollToIndex(i, { align: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    if (!topRowKey) return;
    const first = v.getVirtualItems().find((it) => it.end > (parentRef.current?.scrollTop ?? 0));
    if (first) topRowKey.current = rows[first.index]?.key;
  };
  return { parentRef, v, onScroll };
}

function AlignedList({ rows, showFinal, scrollerRef, topRowKey }: { rows: Row[]; showFinal: boolean; scrollerRef: ScrollerRef; topRowKey: React.MutableRefObject<string | undefined> }) {
  const { result } = useView();
  const { parentRef, v, onScroll } = useList(rows, scrollerRef, topRowKey);
  return (
    <>
      <div className={`colheads${showFinal ? ' with-final' : ''}`}>
        <div className="colhead old">Old · {result.old.fileName}</div>
        <div className="colhead gutter-head">Choice</div>
        <div className="colhead new">New · {result.new.fileName}</div>
        {showFinal && <div className="colhead final">Final result (preview)</div>}
      </div>
      <div className="list" ref={parentRef} onScroll={onScroll}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => (
            <div key={it.key} data-index={it.index} ref={v.measureElement} className="vitem" style={{ transform: `translateY(${it.start}px)` }}>
              <AlignedRowView row={rows[it.index]} showFinal={showFinal} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Sync scroll OFF: two independent panes, natural flow, no spacers. */
function SidePanes({ rows, scrollerRef, topRowKey }: { rows: Row[]; scrollerRef: ScrollerRef; topRowKey: React.MutableRefObject<string | undefined> }) {
  const { result } = useView();
  const hasSide = (r: Row, side: 'old' | 'new') => r.kind === 'gap' || r.kind === 'equal' || r[side].length > 0;
  const oldRows = useMemo(() => rows.filter((r) => hasSide(r, 'old')), [rows]);
  const newRows = useMemo(() => rows.filter((r) => hasSide(r, 'new')), [rows]);
  const oldScroll = useRef<(i: number, a?: 'center' | 'start') => void>(() => {});
  const newScroll = useRef<(i: number, a?: 'center' | 'start') => void>(() => {});
  // Navigation scrolls BOTH panes to the difference.
  scrollerRef.current = (i, align) => {
    const key = rows[i]?.key;
    const oi = oldRows.findIndex((r) => r.key === key);
    const ni = newRows.findIndex((r) => r.key === key);
    if (oi >= 0) oldScroll.current(oi, align);
    if (ni >= 0) newScroll.current(ni, align);
  };
  return (
    <>
      <div className="colheads unsynced">
        <div className="colhead old">Old · {result.old.fileName}</div>
        <div className="colhead new">New · {result.new.fileName}</div>
      </div>
      <div className="panes">
        <SidePane rows={oldRows} side="old" scrollerRef={oldScroll} topRowKey={topRowKey} />
        <SidePane rows={newRows} side="new" scrollerRef={newScroll} />
      </div>
    </>
  );
}

function SidePane({ rows, side, scrollerRef, topRowKey }: { rows: Row[]; side: 'old' | 'new'; scrollerRef: ScrollerRef; topRowKey?: React.MutableRefObject<string | undefined> }) {
  const ctx = useView();
  const { parentRef, v, onScroll } = useList(rows, scrollerRef, topRowKey);
  return (
    <div className={`list pane pane-${side}`} ref={parentRef} onScroll={onScroll}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((it) => {
          const row = rows[it.index];
          const c = row.kind === 'gap' ? null : sideContent(row, side, ctx);
          const ids = rowDiffIds(row).filter((id) => !isHidden(ctx.result.differences[id], ctx.vis));
          return (
            <div key={it.key} data-index={it.index} ref={v.measureElement} className="vitem" style={{ transform: `translateY(${it.start}px)` }}>
              {row.kind === 'gap' ? (
                <GapRow row={row} />
              ) : (
                <div className={`prow${ids.includes(ctx.currentId ?? '') ? ' row-current' : ''}`} onClick={() => ids.length === 1 && ctx.onSelectDiff?.(ids[0])}>
                  {ids.length > 0 && (
                    <div className="inline-ctl">
                      {ids.map((id) => (
                        <DiffControls key={id} d={ctx.result.differences[id]} part={row.kind === 'diff' ? row.part : undefined} compact />
                      ))}
                    </div>
                  )}
                  <div className={`cell ${side} ${c?.cls ?? ''}`}>{c?.node}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Preview only: the final document as one column, with markers back to each difference. */
function FinalOnlyList({ rows, scrollerRef }: { rows: Row[]; scrollerRef: ScrollerRef }) {
  const ctx = useView();
  const a = useContext(ActionsContext);
  const items = useMemo(() => rows.map((r, i) => ({ r, i })), [rows]);
  const { parentRef, v } = useList(
    items.map((x) => x.r),
    scrollerRef,
  );
  return (
    <>
      <div className="colheads final-only">
        <div className="colhead final">Final result (preview) — built from your current choices; unreviewed differences use the new version</div>
      </div>
      <div className="list" ref={parentRef}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const row = items[it.index].r;
            const ids = rowDiffIds(row).filter((id) => !isHidden(ctx.result.differences[id], ctx.vis));
            const content = finalRowContent(row, ctx);
            return (
              <div key={it.key} data-index={it.index} ref={v.measureElement} className="vitem" style={{ transform: `translateY(${it.start}px)` }}>
                {row.kind === 'gap' ? (
                  <GapRow row={row} />
                ) : (
                  <div className={`frow${ids.length ? ' frow-chg' : ''}${ids.includes(ctx.currentId ?? '') ? ' row-current' : ''}`}>
                    <div className="frow-marks">
                      {ids.map((id) => {
                        const st = statusOf({ state: { choices: ctx.choices }, history: { past: [], future: [] } }, id);
                        return (
                          <button key={id} className={`fmark st-${st}`} title={`Difference #${a.number(id)} · ${STATUS_LABEL[st]} — click to review it side by side`} onClick={() => a.reviewInCompare(id)}>
                            #{a.number(id)} {st === 'old' ? 'old' : st === 'new' ? 'new' : '•'}
                          </button>
                        );
                      })}
                    </div>
                    <div className="cell final">{content ?? <div className="final-empty">(removed in final: #{ids.map((id) => a.number(id)).join(', #')})</div>}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
