import type { DiffKind, NormCategory, ScopeStatus } from '../model/diff';
import type { ReviewStatus } from '../model/review';

export const KIND_LABEL: Record<DiffKind, { icon: string; label: string }> = {
  modified: { icon: '✎', label: 'Modified' },
  inserted: { icon: '+', label: 'Inserted' },
  deleted: { icon: '−', label: 'Deleted' },
  moved: { icon: '⇄', label: 'Moved' },
  splitJoin: { icon: '⑂', label: 'Split / joined' },
  tableStructure: { icon: '▦', label: 'Table structure' },
  replaced: { icon: '⇆', label: 'Replaced' },
};

export const CATEGORY_LABEL: Record<NormCategory, string> = {
  whitespace: 'Whitespace',
  emptyParagraph: 'Empty paragraphs',
  quotes: 'Quote style',
  dashes: 'Dash style',
  case: 'Letter case',
  numberingText: 'Numbering text',
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  unreviewed: 'Unreviewed · new by default',
  old: 'Using old',
  new: 'Using new',
  mixed: 'Mixed · chosen per change',
};

export const SCOPE_STATUS_LABEL: Record<ScopeStatus, string> = {
  compared: 'Compared',
  flagged: 'Compared, shown only',
  detectedOnly: 'Detected only',
  shownNotCompared: 'Shown, not compared',
  notSupported: 'Not compared',
};
