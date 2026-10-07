# docdiff — What Is Supported

- Version: draft for v1 (planned scope, not yet implemented)
- Date: 2026-10-07
- Companion to: `Diff-Requirements-v0.2.md`

This page lists what docdiff v1 compares, what it only shows, and what it does not handle. Anything not listed as **Compared** must not be read as "no difference".

Status legend:

| Status | Meaning |
|---|---|
| **Compared** | Differences are detected, highlighted and can be resolved (Use old / Use new). |
| **Detected only** | docdiff tells you *whether* the two versions differ ("may differ"), but does not show the details. Check in Word. |
| **Shown, not compared** | Visible in the view (often as a placeholder such as `[Image · not compared]`), but differences are not detected. |
| **Not supported** | Not handled in v1. See the notes for what happens. |

## 1. Files

| Item | Status | Notes |
|---|---|---|
| `.docx` (Word 2007 and later) | Supported | |
| `.doc` (Word 97–2003) | Not supported | Save as `.docx` in Word first. |
| `.docm`, `.dotx`, `.dotm` | Not supported | Save as `.docx` first. |
| Password-protected or encrypted files | Not supported | Remove the password in Word first. |
| Files with restricted editing (no password encryption) | Supported | Restrictions are kept in the exported file. |
| Strict Open XML format | Not supported | Save as a standard `.docx` in Word first. |
| Language | English text | Other languages may work but word-level highlighting is designed for English. |

Your files never leave your computer. All processing happens in the browser, and the uploaded files are never modified.

## 2. Existing tracked changes

Both files are compared **as if all existing tracked changes were accepted**. The following revision types are handled:

| Revision type | Status |
|---|---|
| Inserted and deleted text | Supported |
| Inserted and deleted paragraphs | Supported |
| Deleted paragraph marks (paragraphs joined) | Supported |
| Moved text and paragraphs | Supported |
| Formatting changes (text and paragraph) | Supported (current formatting is used) |
| Inserted and deleted table rows | Supported |
| Inserted, deleted or merged table cells | Not supported |
| Table property changes | Not supported |
| Section and page setup changes | Not supported |
| Revisions inside text boxes, headers, footers, footnotes | Not supported |

When an unsupported revision type is found, docdiff shows a warning with its type and location, continues the comparison, and lists it in the **Check scope** panel. Results near that location may be inaccurate.

If the **new** file contains pending tracked changes, they will be accepted in the exported file. docdiff shows how many before you export.

## 3. Content comparison

| Element | Status | Notes |
|---|---|---|
| Body text and headings | **Compared** | Word-level highlighting. |
| Paragraph splits and joins | **Compared** | Shown as one difference. |
| Moved paragraphs | **Compared** | Shown as one "Moved" difference. |
| List item text | **Compared** | |
| List numbers and bullets (automatic) | Shown, not compared | Comparison is planned as an option. Inserting an item does not mark later items as changed. |
| Typed numbers (e.g. `1) `) | **Compared** | They are ordinary text. |
| Table cell text | **Compared** | |
| Table rows added or removed | **Compared** | |
| Table columns added or removed, merged-cell changes | **Compared** at table level | The whole table is offered as one choice. |
| Nested tables | **Compared** | Structure changes fall back to a whole-table choice. |
| Superscript and subscript | **Compared** | Treated as content: `10⁶` vs `106` is a difference. |
| Hidden text | **Compared** | Shown with a dotted underline. |
| Whitespace, empty paragraphs, quote style, dash style, letter case | **Compared** | Shown by default; each category can be hidden in View options. |
| Hyperlink display text | **Compared** | |
| Hyperlink address (URL) | Detected only | |
| Content controls | **Compared** (text inside) | Control properties are not compared. |
| Table of contents | Shown, not compared | Collapsed by default; comparison can be switched on. Update fields in Word after export. |
| Date, page number and other fields | Shown, not compared | Comparison can be switched on. |
| Cross-references | **Compared** (displayed result) | |
| Footnote and endnote references | **Compared** (marker position) | |
| Footnote and endnote text | Detected only | |
| Headers and footers (incl. watermarks) | Detected only | |
| Images, charts, shapes, SmartArt | Shown, not compared | Placeholder in the view; images are detected only. |
| Text boxes | Shown, not compared | Placeholder; detected only. |
| Equations | Shown, not compared | Placeholder. |
| Embedded objects | Shown, not compared | Placeholder. |
| Comments | Not compared | Comments in the new file are kept on export; comments in the old file are not imported. |
| Document properties (title, author, …) | Detected only | |
| Formatting: fonts, sizes, colours, bold, italic, spacing, styles, heading level, list type, table formatting | Not compared | Shown as "Formatting: not checked". Planned for a later version. |
| Page setup and section layout | Not compared | Kept from the new file. |

## 4. Resolving differences (Use old / Use new)

Every difference defaults to the **new** version. You can switch any difference to **Use old**, except in the cases below, where **Use old** is unavailable and the reason is shown.

| The difference contains … | Use old available? |
|---|---|
| Plain text, superscript, subscript, tabs, line breaks | Yes |
| Footnote or endnote reference | No (v1) |
| Image, chart, shape, text box, equation, embedded object | No (v1) |
| Hyperlink | No (v1) |
| Field (cross-reference, date, table of contents, …) | No (v1) |
| The start or end of a field or content control that extends outside the difference | No |
| Table column or merged-cell change | Yes, for the whole table only |

When **Use old** is unavailable, export the file and make the change in Word.

Section breaks, bookmarks and comment anchors are never removed by a choice. If a removed paragraph carried a section break, the break moves to the neighbouring paragraph. The page setup of the last section always comes from the new file.

## 5. Export

| Item | Behaviour |
|---|---|
| Clean export | Supported. No tracked changes in the output. |
| Tracked-changes export (new → final) | Planned for a later version. |
| Base file | The new file with existing revisions accepted; only differences set to **Use old** are changed. |
| File name | `<new file name>_merged_YYYYMMDD.docx`. The uploaded files are never overwritten. |
| Fields | Word prompts to update fields when the file is opened, so the table of contents and cross-references refresh. |
| Comments | Comments in the new file are kept. |
| Formatting | The new file's styles are kept; docdiff's on-screen styling is never written to Word. |
| Self-check | After export, docdiff re-reads the file and warns if it does not match the preview. |

## 6. Review progress

- You can save your review progress to a small file and load it later with the same two documents.
- A progress file only loads if both documents are identical to the ones it was saved with.
- Version 1 is designed for one person. Progress files are not designed to be handed from one reviewer to another.
