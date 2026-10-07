// Hand-built mock diffs mirroring testdocs/docs 01–06 (see testdocs/README.md).

import type { DiffResult } from '../model/diff';
import { br, Container, Empty, field, fn, H, hash, hidden, img, LI, link, P, PairBuilder, Placeholder, sup, Table, Title } from './builder';

const TITLE = 'Clinical Study Protocol CX-201';

// ---------------------------------------------------------------------------
export function case01(): DiffResult {
  const b = new PairBuilder({ oldName: '01-basic-text_old.docx', newName: '01-basic-text_new.docx' });
  b.same(
    Title(TITLE),
    H(1, 'Introduction'),
    P('This document describes the design of a randomized, double-blind study of Compound X in adults with moderate hypertension.'),
  );
  // A run of consecutive changes: each modified paragraph is its own difference (decision A2).
  b.grouped((g) =>
    g
      .modified(
        P('Participants will be treated for 12 weeks, followed by a 4-week safety follow-up period.'),
        P('Participants will be treated for 24 weeks, followed by a 4-week safety follow-up period.'),
      )
      .modified(
        P('The primary objective is to evaluate the change in systolic blood pressure from baseline.'),
        P('The primary objective is to assess the change in mean seated systolic blood pressure from baseline to Week 24.'),
      )
      .modified(H(1, 'Study Design'), H(1, 'Study Design and Duration')),
  );
  b.same(P('Eligible participants will be randomized in a 1:1 ratio to Compound X or placebo.'));
  b.inserted(P('Randomization will be stratified by site and baseline blood pressure category.'));
  b.grouped((g) =>
    g
      .modified(
        P('Visits will occur at screening, baseline, and Weeks 2, 4, 8 and 12.'),
        P('Visits will occur at screening, baseline, and Weeks 2, 4, 8, 12, 16 and 24.'),
      )
      .deleted(P('An interim analysis is not planned for this study.')),
  );
  b.same(
    P('The sponsor will provide study drug in identical blister packs.'),
    // Bold/colour/font change only: no content difference.
    P('All adverse events must be reported within 24 hours of awareness.'),
    // Different run fragmentation, proofing marks, bookmark: no content difference.
    P('The investigator is responsible for maintaining accurate source documents.'),
  );
  // Heading 2 → Heading 3: same text, not a content difference. Each side keeps its own level.
  b.sameContent(H(2, 'Safety Monitoring'), H(3, 'Safety Monitoring'));
  b.same(
    P('A Data Monitoring Committee will review unblinded safety data every six months.'),
    H(1, 'Ethics'), // new has "page break before": pagination only
    P('The protocol will be approved by an independent ethics committee before enrollment begins.'),
    P('This protocol will be conducted in accordance with Good Clinical Practice.'),
  );
  return b.build();
}

// ---------------------------------------------------------------------------
export function case02(): DiffResult {
  const b = new PairBuilder({
    oldName: '02-lists_old.docx',
    newName: '02-lists_new.docx',
    lists: {
      HN: { levels: ['1.'] },
      L1: { levels: ['1.', 'a)'] },
      L2: { levels: ['bullet'] },
      L3: { levels: ['1.', 'a)'] },
      L5: { levels: ['1.'] },
    },
  });
  const KNOWN = 'Known hypersensitivity to Compound X.';
  b.same(Title(`${TITLE} - Eligibility`), H(1, 'Inclusion Criteria', 'HN'), LI('L1', 0, 'Age 18 to 75 years at screening.'));
  // Inserting an item shifts later numbers: the shift is NOT shown as a change.
  b.inserted(LI('L1', 0, 'Diagnosis of essential hypertension for at least 3 months.'));
  b.same(LI('L1', 0, 'Seated systolic blood pressure between 140 and 179 mmHg.'), LI('L1', 0, 'Able to provide written informed consent.'));
  b.modified(LI('L1', 0, 'Body mass index below 40 kg/m2.'), LI('L1', 0, 'Body mass index below 35 kg/m2.'));

  b.same(H(1, 'Exclusion Criteria', 'HN'));
  // "Known hypersensitivity…" moved from the end of the list to the start.
  b.moveTo('known', LI('L3', 0, KNOWN));
  b.deleted(LI('L3', 0, 'History of stroke or myocardial infarction within 6 months.'));
  b.same(LI('L3', 0, 'Pregnant or breastfeeding women.'));
  b.modified(
    LI('L3', 1, 'Women of childbearing potential must use effective contraception.'),
    LI('L3', 1, 'Women of childbearing potential must use highly effective contraception.'),
  );
  b.same(LI('L3', 0, 'Participation in another interventional study within 30 days.'));
  b.moveFrom('known', LI('L3', 0, KNOWN));

  b.same(H(1, 'Prohibited Medications', 'HN'));
  // Bullet list → numbered list is a list-type (formatting) change; only the new item is reported.
  for (const m of ['Other antihypertensive agents', 'Systemic corticosteroids', 'Strong CYP3A4 inhibitors']) b.sameContent(LI('L2', 0, m), LI('L5', 0, m));
  b.grouped((g) =>
    g
      .inserted(LI('L5', 0, "St. John's Wort"))
      .inserted(H(1, 'Concomitant Medications', 'HN'), P('Stable doses of lipid-lowering therapy are permitted.')),
  );
  b.same(H(1, 'Study Procedures', 'HN'));
  // Typed "1) " → automatic numbering: the typed text disappears, so it IS a text change.
  // (The new list continues list L1 on purpose, so the automatic labels read 6., 7., 8.)
  b.grouped((g) => {
    ['Obtain informed consent.', 'Record vital signs.', 'Collect blood samples.'].forEach((s, i) => g.modified(P(`${i + 1}) ${s}`), LI('L1', 0, s)));
  });
  return b.build();
}

// ---------------------------------------------------------------------------
export function case03(): DiffResult {
  const b = new PairBuilder({ oldName: '03-tables_old.docx', newName: '03-tables_new.docx' });
  b.same(Title(`${TITLE} - Tables`), H(1, 'Dose Cohorts'), P('Table 1 lists the planned dose cohorts.'));
  b.tablePair([2000, 3000, 3000], (r) =>
    r
      .same({ cells: ['Cohort', 'Dose', 'Participants'], header: true })
      .same(['1', '10 mg', '12'])
      .inserted(['1b', '15 mg', '6'])
      .pair(['2', '20 mg', '12'], ['2', '20 mg', '18'])
      .deleted(['3', '40 mg', '12'])
      .same(['4', '80 mg', '12'])
      .inserted(['5', '160 mg', '6']),
  );
  b.same(P('Dose escalation will proceed after review of safety data from each cohort.'), H(1, 'Schedule of Assessments'));
  // Column inserted → whole-table choice.
  b.tableStructure(
    Table([3200, 1600, 1600, 1600], [
      ['Assessment', 'Screening', 'Baseline', 'Week 12'],
      ['Informed consent', 'X', '', ''],
      ['Vital signs', 'X', 'X', 'X'],
      ['ECG', 'X', '', 'X'],
      ['Laboratory tests', 'X', 'X', 'X'],
    ]),
    Table([3200, 1300, 1300, 1300, 1300], [
      ['Assessment', 'Screening', 'Baseline', 'Week 4', 'Week 24'],
      ['Informed consent', 'X', '', '', ''],
      ['Vital signs', 'X', 'X', 'X', 'X'],
      ['ECG', 'X', '', '', ''],
      ['Laboratory tests', 'X', 'X', 'X', 'X'],
    ]),
    [
      [null, 'Week 4'],
      ['Week 12', 'Week 24'],
    ],
    { summary: 'Column "Week 4" added; header Week 12 → Week 24; ECG cell cleared' },
  );
  b.same(H(1, 'Laboratory Panels'));
  const M = (text: string) => ({ text, vmerge: 'restart' as const });
  const C = { text: '', vmerge: 'continue' as const };
  // Vertical merge extended + new full-width row → merged-cell structure change → whole table.
  b.tableStructure(
    Table([2600, 3400, 2600], [
      ['Panel', 'Test', 'Units'],
      [M('Hematology'), 'Hemoglobin', 'g/dL'],
      [C, 'Platelets', '10^9/L'],
      [C, 'White blood cells', '10^9/L'],
      [M('Chemistry'), 'ALT', 'U/L'],
      [C, 'Creatinine', 'mg/dL'],
    ]),
    Table([2600, 3400, 2600], [
      ['Panel', 'Test', 'Units'],
      [M('Hematology'), 'Hemoglobin', 'g/dL'],
      [C, 'Platelets', '10^9/L'],
      [C, 'White blood cells', '10^9/L'],
      [C, 'Neutrophils', '10^9/L'],
      [M('Chemistry'), 'ALT', 'U/L'],
      [C, 'Creatinine', 'umol/L'],
      [{ text: 'Note: all samples will be analyzed by the central laboratory.', span: 3 }],
    ]),
    [
      [null, 'Neutrophils'],
      ['mg/dL', 'umol/L'],
      [null, 'Note: all samples will be analyzed by the central laboratory.'],
    ],
    { summary: 'Merged cell extended; row added; spanning note row added; unit changed' },
  );
  b.same(H(1, 'Study Contacts'));
  // Paragraphs ↔ table: whole block.
  b.replaced(
    [P('Sponsor: Acme Pharma Ltd.'), P('CRO: Beta Research Inc.')],
    [Table([3000, 5000], [['Role', 'Organization'], ['Sponsor', 'Acme Pharma Ltd.'], ['CRO', 'Beta Research Inc.']])],
    { summary: '2 paragraphs → table' },
  );
  b.same(H(1, 'Abbreviations'));
  b.replaced(
    [Table([3000, 5000], [['Abbreviation', 'Definition'], ['AE', 'Adverse event'], ['ECG', 'Electrocardiogram']])],
    [P('Abbreviations are defined at first use in the text.')],
    { summary: 'Table → paragraph' },
  );
  b.same(H(1, 'Nested Table'));
  // Nested table: the inner cell edit is a cell-level difference inside the outer row pair.
  const details = {
    nested: (c: Container) =>
      c
        .same(P('Windows are relative to baseline:'))
        .tablePair([1800, 1800], (ir) =>
          ir.same({ cells: ['Visit', 'Window'], header: true }).pair(['Week 4', '+/- 3 days'], ['Week 4', '+/- 5 days']),
        ),
  };
  b.tablePair([3000, 5000], (r) => r.same({ cells: ['Item', 'Details'], header: true }).pair(['Visit windows', details], ['Visit windows', details]));
  b.same(P('End of tables.'));
  return b.build();
}

// ---------------------------------------------------------------------------
export function case05(): DiffResult {
  const b = new PairBuilder({
    oldName: '05-uncompared-and-comments_old.docx',
    newName: '05-uncompared-and-comments_new.docx',
    oldSections: [{ header: 'Protocol CX-201 - Confidential', footer: 'Page {PAGE} of {NUMPAGES}' }],
    // New: a section break on "End of main protocol." starts a landscape appendix whose
    // header and footer are linked to the previous section.
    newSections: [
      { header: 'Protocol CX-201 v2.0 - Confidential', footer: 'Page {PAGE} of {NUMPAGES}' },
      { header: { default: 'linked' }, footer: { default: 'linked' } },
    ],
    oldParts: {
      footnotes: hash('HEM-907'),
      images: hash('red'),
      hyperlinkUrls: hash('old-label'),
      properties: hash('props'),
    },
    newParts: {
      footnotes: hash('HEM-907XL|averaged'),
      images: hash('blue'),
      hyperlinkUrls: hash('label-2026'),
      properties: hash('props'),
    },
    oldComments: 1,
    newComments: 3,
    pendingRevisionsInNew: 0,
    newRevisions: {
      accepted: [],
      unsupported: [{ type: 'Section and page setup change', location: 'Paragraph "End of main protocol."' }],
    },
    extraScope: [
      { element: 'Footnote text', status: 'detectedOnly', oldCount: 1, newCount: 2 },
      { element: 'Hyperlink addresses', status: 'detectedOnly', oldCount: 1, newCount: 1 },
      { element: 'Document properties', status: 'detectedOnly', oldCount: 1, newCount: 1 },
    ],
  });
  const tocEntry = (text: string, page: number) => P([text, { type: 'tab' }, String(page)]);
  b.same(Title(`${TITLE} - Other Elements`));
  // DATE field: shown, not compared unless "Compare fields" is on → informational only.
  b.info(
    'fields',
    P(['Version date: ', field('DATE', 'DATE \\@ "yyyy-MM-dd"', '2026-03-01')]),
    P(['Version date: ', field('DATE', 'DATE \\@ "yyyy-MM-dd"', '2026-09-15')]),
  );
  // TOC: collapsed, not compared unless "Compare table of contents" is on.
  b.info(
    'toc',
    Placeholder('toc', 'Table of contents', hash('toc-old'), [tocEntry('Treatment', 1), tocEntry('Measurements', 1), tocEntry('Safety Reporting', 2)]),
    Placeholder('toc', 'Table of contents', hash('toc-new'), [
      tocEntry('Treatment', 1),
      tocEntry('Measurements', 1),
      tocEntry('Safety Reporting Requirements', 2),
      tocEntry('Appendix A. Detailed Schedule', 3),
    ]),
  );
  b.same(H(1, 'Treatment'));
  b.modified(P('Treatment duration is 12 weeks.'), P('Treatment duration is 24 weeks.'), { summary: '12 → 24 (a new-file comment is anchored here)' });
  b.same(P('The dose may be titrated once after Week 2.'));
  b.inserted(P('Missed doses should not be replaced.'));
  b.same(H(1, 'Measurements'));
  // Footnote text differs (HEM-907 → HEM-907XL) but footnote text is "detected only": no diff here.
  b.same(P(['Blood pressure will be measured using a validated device.', fn(1, hash('HEM-907'))]));
  // New footnote reference added → difference; "Use old" disabled because it contains a footnote.
  b.modified(P('The mean of three seated readings will be used.'), P(['The mean of three seated readings will be used.', fn(2, hash('avg'))]));
  // Hyperlink: same display text, different URL → no content diff; scope panel shows "may differ".
  b.same(P(['Full prescribing information is available on the ', link('sponsor website', 'https://example.com/compound-x/label'), '.']));
  b.same(P([img('Picture 1', hash('red'))]), P('Figure 1. Study schema.'));
  b.modified(
    P('Measurements are taken in the morning.'),
    P(['Measurements are taken in the morning.', hidden(' INTERNAL NOTE: confirm timing with sponsor.')]),
    { summary: 'Hidden text added' },
  );
  b.modified(H(1, 'Safety Reporting'), H(1, 'Safety Reporting Requirements'));
  // Cross-reference result follows the renamed heading; contains a field → "Use old" unavailable.
  b.modified(
    P(['Serious adverse events are described in ', field('REF', 'REF _Ref500 \\h', 'Safety Reporting'), '.']),
    P(['Serious adverse events are described in ', field('REF', 'REF _Ref500 \\h', 'Safety Reporting Requirements'), '.']),
  );
  b.same(P('Pregnancies must be reported within 24 hours.'));
  // New landscape appendix, introduced by a section break on a new paragraph.
  b.inserted(
    P('End of main protocol.', { sectionBreak: true }),
    H(1, 'Appendix A. Detailed Schedule'),
    P('This appendix is printed in landscape orientation.'),
  );
  const r = b.build();
  // The image paragraph is equal by text; its fingerprint differs (red → blue) → "may differ" badge.
  const img2 = r.new.blocks.find((x) => x.kind === 'paragraph' && x.content[0]?.type === 'placeholder');
  if (img2?.kind === 'paragraph' && img2.content[0].type === 'placeholder') img2.content[0].fingerprint = hash('blue');
  const fnPara = r.new.blocks.find((x) => x.kind === 'paragraph' && x.content.some((i) => i.type === 'placeholder' && i.kind === 'footnoteRef'));
  if (fnPara?.kind === 'paragraph') for (const i of fnPara.content) if (i.type === 'placeholder') i.fingerprint = hash('HEM-907XL');
  return r;
}

// ---------------------------------------------------------------------------
export function case06(): DiffResult {
  const b = new PairBuilder({ oldName: '06-edge-alignment_old.docx', newName: '06-edge-alignment_new.docx' });
  b.same(Title(`${TITLE} - Alignment Edge Cases`), H(1, 'Exploratory Assessments'));
  b.same(H(2, 'Pharmacokinetics'), P('Not applicable.'));
  // The deleted pair is the heading AND the paragraph after it — not another "Not applicable.".
  b.deleted(H(2, 'Pharmacogenomics'), P('Not applicable.'));
  b.same(H(2, 'Biomarkers'), P('Not applicable.'), H(2, 'Immunogenicity'), P('Not applicable.'));
  b.same(H(1, 'Visits'));
  b.moveFrom('deviations', P('Protocol deviations will be documented in the trial master file.'));
  b.splitJoin(
    [P('Participants will attend a screening visit. Eligible participants will then be randomized at the baseline visit.')],
    [P('Participants will attend a screening visit.'), P('Eligible participants will then be randomized at the baseline visit.')],
    { summary: '1 paragraph split into 2' },
  );
  b.splitJoin(
    [P('Blood samples will be collected after an overnight fast.'), P('Samples will be processed within 2 hours.')],
    [P('Blood samples will be collected after an overnight fast and processed within 2 hours.')],
    { summary: '2 paragraphs joined into 1' },
  );
  b.same(Empty());
  b.deleted(Empty());
  b.same(P('Unscheduled visits may be performed at the discretion of the investigator.'));
  b.inserted(Empty(), Empty());
  b.moveTo('deviations', P('Protocol deviations will be documented in the trial master file.'));

  b.same(H(1, 'Typography'));
  b.grouped((g) =>
    g
      .modified(P('Acme Pharma Ltd. (the "Sponsor") is responsible for the study.'), P('Acme Pharma Ltd. (the “Sponsor”) is responsible for the study.'))
      .modified(P('This is a Phase II - III seamless design.'), P('This is a Phase II–III seamless design.'))
      .modified(P('See Section  5 for details.'), P('See Section 5 for details.'))
      .modified(P('The starting dose is 10 mg.'), P('The starting dose is 10 mg.'))
      .modified(P('Assessments occur at Week 12.'), P('Assessments occur at week 12.')),
  );
  b.same(H(1, 'Superscript and Line Breaks'));
  b.grouped((g) =>
    g
      .modified(P(['Viral load above 10', sup('6'), ' copies/mL is exclusionary.']), P(['Viral load above 10', sup('5'), ' copies/mL is exclusionary.']))
      .modified(P(['Body mass index is reported in kg/m', sup('2'), '.']), P('Body mass index is reported in kg/m2.'))
      .modified(P('Contact: Dr. Jane Smith, Medical Monitor'), P(['Contact:', br, 'Dr. Jane Smith, Medical Monitor'])),
  );
  b.same(H(1, 'Rewrites'));
  const longOld =
    'The investigator must ensure that all study personnel are adequately trained on the protocol, the investigational product, and their study-related duties. The investigator will maintain a delegation log listing all individuals to whom study tasks have been delegated, together with their signatures and the dates of delegation. Training records must be filed in the investigator site file and made available for monitoring visits, audits, and regulatory inspections. Any new staff member joining the study team after site initiation must complete protocol training before performing any study-related activity, and this training must be documented within 5 working days.';
  b.grouped((g) =>
    g
      .modified(
        P('Compliance will be assessed by pill count at each visit.'),
        P('Adherence is calculated from returned blister packs and recorded in the eCRF by site staff.'),
      )
      .modified(P(longOld), P(longOld.replace('within 5 working days', 'within 10 working days'))),
  );
  return b.build();
}
