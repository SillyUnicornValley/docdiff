import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Popover({ label, title, children, align = 'left' }: { label: ReactNode; title?: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="popover" ref={ref}>
      <button className={`btn${open ? ' active' : ''}`} onClick={() => setOpen(!open)} title={title} aria-expanded={open}>
        {label} ▾
      </button>
      {open && <div className={`popover-panel align-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/**
 * Explanation shown on demand (decision 40): the page keeps a short label, the
 * "why / what to do" opens on hover at once, or on focus or click (touch) of the
 * ⓘ. `icon={false}` for marks inside the document text, where an ⓘ on every
 * mark would be clutter: the mark itself then takes focus and clicks.
 */
export function Tip({ tip, children, icon = true, className }: { tip: ReactNode; children?: ReactNode; icon?: boolean; className?: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || pinned;

  useLayoutEffect(() => {
    if (!open || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    const w = tipRef.current?.offsetWidth ?? 300;
    const h = tipRef.current?.offsetHeight ?? 80;
    const above = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ left, top: above ? r.top - 6 - h : r.bottom + 6, above });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setHover(false);
      setPinned(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const toggle = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    setPinned((v) => !v);
  };
  return (
    <span
      ref={ref}
      className={`tip-anchor${icon ? '' : ' tip-self'}${className ? ` ${className}` : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      {...(icon ? {} : { tabIndex: 0, onClick: toggle, 'aria-describedby': open ? id : undefined })}
    >
      {children}
      {icon && (
        <button type="button" className="tip-icon" aria-label="More information" aria-describedby={open ? id : undefined} aria-expanded={open} onClick={toggle}>
          ⓘ
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="tip"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ req, onClose }: { req: ConfirmRequest; onClose: () => void }) {
  return (
    <Modal
      title={req.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {req.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
            onClick={() => {
              onClose();
              req.onConfirm();
            }}
          >
            {req.confirmLabel}
          </button>
        </>
      }
    >
      {req.message}
    </Modal>
  );
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'warn' | 'error';
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone ?? 'info'}`}>
          <span>{t.text}</span>
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));
  const push = (text: string, tone: Toast['tone'] = 'info') => {
    const id = next.current++;
    setToasts((ts) => [...ts.slice(-3), { id, text, tone }]);
    setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 5000);
  };
  return { toasts, push, dismiss };
}

export function downloadText(fileName: string, text: string, type = 'application/json') {
  void downloadBlob(fileName, new Blob([text], { type }));
}

interface ClaudeHost {
  use(name: 'downloads'): Promise<{ save(r: { filename: string; data: Blob }): Promise<unknown> } | null>;
}

/**
 * Save a file. Inside a claude.ai Artifact the page cannot download directly:
 * the `downloads` capability asks the viewer to confirm instead. Everywhere
 * else (the single HTML file, Posit Connect) a normal browser download.
 */
export async function downloadBlob(fileName: string, blob: Blob) {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = await host.use('downloads').catch(() => null);
    if (downloads) {
      await downloads.save({ filename: fileName, data: blob }).catch(() => {}); // declined: nothing to do
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function yyyymmdd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
