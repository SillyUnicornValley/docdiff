# docdiff User Guide

*Compare two versions of a Word document side by side, choose old or new for each difference, and export the merged document.*

Version 0.5.1 · October 2026

> **Status:** docdiff is feature-complete but is still being validated on company computers. Until version 1.0 is released, check every exported file in Word before you use it.

---

## Contents

1. [What docdiff does](#1-what-docdiff-does)
2. [Before you start](#2-before-you-start)
3. [Quick start](#3-quick-start)
4. [Step by step](#4-step-by-step)
5. [What is compared and what is not](#5-what-is-compared-and-what-is-not)
6. [Important notes and limitations](#6-important-notes-and-limitations)
7. [Troubleshooting and FAQ](#7-troubleshooting-and-faq)
8. [Quick reference](#8-quick-reference)

---

## 1. What docdiff does

You have an **old** and a **new** version of a Word document, for example a protocol, an SOP or a plan. The new version may contain changes that you want to keep, and changes that you want to undo. docdiff helps you:

1. **See every content change.** The old version is on the left and the new version is on the right, aligned paragraph by paragraph like a code diff. Changed words are highlighted.
2. **Decide on each change.** For every difference, click **Use old** or **Use new**. Anything you do not decide keeps the new version.
3. **Export the result.** docdiff writes a clean Word file. It starts from the new document and changes only the places where you chose the old version.

**Your files never leave your computer.** Everything runs inside your browser. Nothing is uploaded to a server, and your original files are never modified.

### When to use it

- Reviewing what changed between two versions of a document, especially long ones with tables.
- Rolling back some edits in a new version while keeping the others.
- Producing a clean merged version without accepting or rejecting tracked changes one by one in Word.

### When not to use it

- **Checking formatting changes.** docdiff compares content (text, lists, tables), not formatting (fonts, bold, spacing, styles). See [§5](#5-what-is-compared-and-what-is-not).
- **Comparing two unrelated documents**, such as contracts from two vendors. docdiff always treats one file as "old" and one as "new", and builds the result from the new one.
- **Excel files.** Only Word `.docx` is supported for now.
- **Writing new text.** You can only choose between the old and the new wording. If you need a third wording, export first, then edit the file in Word.

---

## 2. Before you start

| You need | Details |
|---|---|
| A browser | Microsoft Edge or Google Chrome on Windows. A wide window (about 1400 px or more) works best. |
| Two `.docx` files | An old version and a new version of the same document. |
| docdiff | Open the docdiff link on Posit Connect, or double-click the docdiff HTML file you received. The offline file works without a network connection. |

### Supported files

| File | Supported? | What to do |
|---|---|---|
| `.docx` (Word 2007 and later) | Yes | — |
| `.doc` (Word 97–2003) | No | In Word: **File › Save As › Word Document (\*.docx)**, then use the new file. |
| `.docm`, `.dotx`, `.dotm` | No | Save as a standard `.docx` in Word first. |
| Password-protected or encrypted | No | Remove the password in Word first. |
| Restricted editing (not encrypted) | Yes | The restriction is kept in the exported file. |
| Strict Open XML format | No | Save as a standard `.docx` in Word. |

docdiff is designed for **English** documents. Other languages may work, but word-level highlighting is tuned for English.

### Tracked changes in your files

If either file contains tracked changes, docdiff compares the files **as if all tracked changes were accepted**. This applies to the whole file: body, headers, footers, footnotes and comments. Your original files are not changed.

If the **new** file has pending tracked changes, they are accepted in the exported file. The export dialog tells you how many.

---

## 3. Quick start

1. Open docdiff.
2. Drop the **old** file on the left box and the **new** file on the right box, or click **Choose file…**. Then click **Compare**.
3. Press **J** to jump from one difference to the next. For each one, click **Use old** or **Use new**, or press **1** or **2**.
4. To see the merged document, set **Final result** to **Third column** or **Preview only**.
5. Click **Export…** and then **Export**. Open the downloaded `…_merged_YYYYMMDD.docx` in Word and check it.

To try docdiff without your own files, click any **Sample pair** on the start page.

---

## 4. Step by step

### 4.1 Choose the files

- **Left box (− Old version):** the earlier version. **Right box (+ New version):** the later version.
- You can drag and drop a file, or click **Choose file…**. Use **Replace…** or **Remove** to change a file.
- **⇄ Swap** exchanges the two files.
- Unsupported files show a red message explaining what to do.
- Click **Compare**. A progress window shows the steps. Long documents (200+ pages) can take a few seconds.

> If you already made choices and then swap, replace or change the files, docdiff asks you to confirm. Your choices are cleared.

### 4.2 Read the comparison

The screen has four parts:

| Part | What it shows |
|---|---|
| **Top bar** | File names, the **Content / Formatting / Other parts** tabs, your progress (*Reviewed 12 / 40*), **Progress** (save and load), **Check scope**, and **Export…** |
| **Info bar** | Short notes such as *Tracked changes accepted*, heading-level changes (⚑) and numbering changes (№). Hover over a note to see what it means. Click it to see the full list. |
| **Toolbar** | Navigation, **Batch**, **Undo** and **Redo**, **View**, and the **Final result** switch |
| **Document** | Old on the left, new on the right, and the choice column between them |

#### Colours and symbols

You can tell changes apart without relying on colour:

| Mark | Meaning |
|---|---|
| Red edge, **−**, ~~struck-through~~ words | Text in the old version that was removed or replaced |
| Green edge, **+**, <u>underlined</u> words | Text in the new version that was added or is the replacement |
| Blue edge, **⇄** | Moved content |
| Hatched blank area, e.g. *not in old* | This content exists only on the other side. The blank area keeps the two sides aligned. |
| `·` `°` `↵` `¶` | Space, non-breaking space, line break, and paragraph split or join. Shown only where they make a difference. |

#### Types of difference

| Label | Meaning |
|---|---|
| **Modified** | A paragraph (or table cell) whose wording changed. The changed words are highlighted. |
| **Inserted** | Content only in the new version. Several new paragraphs in a row are one difference. |
| **Deleted** | Content only in the old version. |
| **Moved** | The same paragraph in a different place. This is **one** difference shown in two places. Use the *go to original ↑* / *go to new ↓* links to jump between them. **✎ Moved and text changed** means the wording was also edited. |
| **Split / joined** | One paragraph became two, or two became one. |
| **Table structure** | Columns were added or removed, or cells were merged. You can only choose the whole table (*Whole-table choice*). |
| **Replaced** | A paragraph became a table, or a table became paragraphs. |

#### Other marks in the text

These marks are **for information only**. You cannot choose old or new for them, and the export keeps the new version.

| Mark | Meaning |
|---|---|
| **⚑ Heading 1 → Heading 2** | The heading level changed but the text did not. |
| **№ 3. → 4.** | The automatic number changed, usually because an item was inserted above. Word recalculates numbers, so this is not a content change. |
| **Comment · Name** | A comment in the new file starts here. |
| **Old comment · Name** (grey) | A comment that exists in the old file. |
| **§ Section n** | The header or footer of this section may differ. See **Other parts**. |
| `[Image · not compared]`, `[Footnote 2]` | Placeholders for content that is not compared in the main text. `differs` means the content is different. Details are in **Other parts**. |
| Grey box marked **FIELD** | A field such as a date or page number. Fields are not compared by default (see View options). |

### 4.3 Make your choices

Every difference has a card in the middle column:

- **Use old**: put the old version back here.
- **Use new**: keep the new version. This is also what happens if you make no choice.
- **Mark unreviewed**: remove your choice.

Before you choose, both sides are shown normally and the card has a dashed border. After you choose, the side you did not pick is faded.

For a moved paragraph, one choice covers both places. **Use old** puts it back in its original place. **Use new** keeps it in its new place.

#### Choose per change (inside one paragraph)

When one paragraph has several changes, the card shows **▸ Choose per change (N)**. Expand it to choose **Old** or **New** for each change separately. For example, you can keep the new "Week 16" but restore the old "12 weeks". The status becomes **Mixed**.

> Mixing old and new words inside one sentence can produce wording that reads badly. Always read the paragraph in the final result.

#### When "Use old" is unavailable

Some old content cannot be copied into the new file safely. The card then shows **Use old unavailable**. Hover over it to see the reason. Typical reasons:

- The old content contains a chart, shape, SmartArt, text box or embedded object.
- A cross-reference points to a bookmark that does not exist in the new file.
- A field or content control starts inside the difference and ends outside it.
- A picture is linked to an external file instead of embedded.

In these cases, export first, then make the change in Word by hand.

Old content with **footnotes, endnotes, hyperlinks, embedded pictures, equations or ordinary fields** *can* be restored. docdiff copies them into the new file.

#### Batch choices

**Batch** applies a choice to many differences at once:

- Choose a section, then **All in this section → Use new** or **→ Use old**. Differences where Use old is unavailable are skipped.
- **All unreviewed → Use new** marks everything you have not decided yet.

A batch action is a single undo step.

#### Undo and redo

**↶ Undo** and **↷ Redo** work for every choice, including batch actions and loading a progress file. Hover over the buttons to see which action they will undo or redo.

### 4.4 Check the final result

Use the **Final result** switch in the toolbar:

| Setting | What you see |
|---|---|
| **Hidden** | Only old and new. |
| **Third column** | A third column with the merged result next to old and new. |
| **Preview only** | The merged document on its own, as one column. Click a difference number in the margin to go back to it in the side-by-side view. |

In the final result, content taken from the old file has an amber background and the tag **FROM OLD**. Paragraphs chosen per change are tagged **MIXED**.

### 4.5 View options

The **View** menu changes what you see. It does not change the result.

- **Sync scroll by aligned content:** keep the two sides lined up. Turn this off to scroll each side on its own.
- **Collapse unchanged content / Differences only:** hide long stretches of identical text.
- **Show differences in:** hide minor differences by type: *Whitespace*, *Empty paragraphs*, *Quote style* (straight vs curly), *Dash style* (- vs –), *Letter case*, *Numbering text*. Hidden differences still count in your progress (*· N hidden*). They keep the new version unless you choose otherwise.
- **Optional comparisons (info only):** compare the table of contents, or date, page and other fields. These differences are numbered #i1, #i2… and cannot be chosen.
- **Mark automatic numbering changes:** show or hide the № marks.

### 4.6 Other parts and Check scope

**Other parts tab.** Parts outside the main text are compared item by item, with highlighted wording:

- Comments: *Same*, *Comment text changed*, *Commented text changed*, *Only in old*, or *Only in new*
- Footnotes and endnotes
- Headers and footers, by section and by type (first page, odd/default, even)
- Text boxes
- Hyperlink addresses, pictures, and document properties (title, subject and so on)

These are **for information only**. The export always keeps the new file's version. Click **Show in document** to jump to the paragraph in the Content view. To restore any of these, edit the exported file in Word.

**Check scope panel.** Click **Check scope** in the top bar to see what was compared, what was only detected, and what was not checked at all. Treat anything that is not marked **Compared** as unchecked. It does **not** mean there is no difference.

**Formatting tab.** This tab shows *Formatting: not checked*. Formatting is not compared in this version.

### 4.7 Save your progress and continue later

- **Progress › Save progress…** downloads a small file named `<new file>_review_YYYYMMDD.json`. It contains your choices and a fingerprint of both documents. It does **not** contain the document text.
- To continue later, open docdiff, compare **the same two files** again, then use **Progress › Load progress…**. If the files are different, docdiff refuses to load the progress and tells you which file does not match.
- docdiff also keeps your choices in the browser automatically. When you reopen the same two files, it asks *Restore your previous choices?*. This is only a backup. Browsers can clear it, so save a progress file for anything important.
- If you try to close the page with unsaved choices, the browser warns you.

### 4.8 Export the merged document

Click **Export…**. Before writing the file, the dialog lists:

- how many differences are still unreviewed (they will use the **new** version)
- how many differences use the old version
- any differences set to Use old that have a comment from the new file attached (the comment is kept but may now be on other text)
- how many pending tracked changes in the new file will be accepted

Click **Export** to write the file. It is named `<new file>_merged_YYYYMMDD.docx`.

What you get:

- **Clean format:** the final content with no tracked changes. Comments from the new file are kept. Comments from the old file are not carried over.
- The new file's styles, page setup, headers, footers and properties are kept. Text brought back from the old file takes the formatting of the new text around it.
- When you open the file, Word asks whether to update fields. Click **Yes** so the table of contents and cross-references refresh.

**Self-check.** After writing the file, docdiff reads it back and compares it with the final-result preview. If they match, the file downloads and a message says *Self-check passed*. If they do not match, nothing downloads yet. docdiff shows where the file differs and lets you choose **Download anyway** or cancel. If you download anyway, check those places carefully in Word.

*Tracked changes* export (showing your merge as tracked changes in Word) is planned for a later version.

---

## 5. What is compared and what is not

| Content | Status | Can you choose old or new? |
|---|---|---|
| Body text and headings | Compared, word by word | Yes |
| Paragraph splits, joins and moves | Compared | Yes |
| List item text; manually typed numbers like `1)` | Compared | Yes |
| Table cell text, added or removed rows | Compared | Yes, per cell or per group of rows |
| Table columns, merged cells | Compared | Whole table only |
| Superscript and subscript (`10⁶` vs `106`) | Compared as content | Yes |
| Hidden text | Compared, shown with a dotted underline | Yes |
| Whitespace, quote style, dashes, letter case | Compared (can be hidden in View) | Yes |
| Hyperlink text, cross-reference results, footnote reference positions | Compared | Yes |
| Heading level changes | Flagged ⚑ | No, the new level is kept |
| Automatic numbering | Flagged № | No, Word recalculates numbers |
| Footnote and endnote text, headers and footers, text boxes | Compared in Other parts | No, the new version is kept |
| Comments | Compared in Other parts | No, new comments are kept and old ones are not added |
| Hyperlink addresses, pictures, document properties | Differences listed in Other parts | No, the new version is kept |
| Table of contents, date and page fields | Shown; optional comparison in View | No |
| Charts, shapes, SmartArt, equations, embedded objects | Shown as placeholders, not compared | No |
| **Formatting** (fonts, sizes, colours, bold and italic, spacing, alignment, styles, list types, table styles) | **Not checked** | No, the new formatting is kept |
| Page setup and section layout | Not compared | No, the new setup is kept |

---

## 6. Important notes and limitations

**Always check the exported file in Word.** The self-check confirms that the file contains what the preview showed. It cannot judge whether the layout looks right.

1. **Formatting is not compared.** If someone only changed fonts, colours, bold or spacing, docdiff shows no difference. Use Word's own *Compare* feature if formatting matters.
2. **"No difference" only covers what was compared.** Check the **Check scope** panel and the **Other parts** tab before you conclude that two files are the same.
3. **The new file is the base.** Anything you do not choose, and everything outside the main text (headers, footers, footnote text, comments, properties, formatting), comes from the new file.
4. **Pending tracked changes in the new file are accepted** in the export. If someone still needs to review them, do that in Word first.
5. **Restored text takes the formatting around it.** Old text that is put back takes the formatting of the new text it replaces. An old paragraph brought back on its own keeps its paragraph style (matched by name) and simple emphasis (bold, italic, underline) but not its font, size or colour.
6. **Paragraphs with footnotes, links or pictures are replaced whole.** If you choose Use old for a modified paragraph that contains such items, the whole paragraph's content is replaced, and unchanged words also take the old formatting.
7. **Restored list items may lose their numbering** if the matching list no longer exists in the new file. Check numbered lists after export.
8. **Restored tables** keep their old layout. If they used a table style that the new file does not have, only borders and shading set directly on the table are kept.
9. **Comments can shift.** If you restore old text where a new comment was anchored, the comment is kept but may end up on nearby text. The export dialog warns you about these.
10. **Choose per change can produce awkward sentences.** Read mixed paragraphs in the final result.
11. **Fields and the table of contents** are not refreshed by docdiff. Click Yes when Word asks to update fields.
12. **Progress files only work with the same two files.** If either document changes, even slightly, the old progress file cannot be loaded. A progress file from an older version of docdiff may restore only some choices.

---

## 7. Troubleshooting and FAQ

**The Compare button is greyed out.**
Both boxes need a supported `.docx`. Look for a red message in the boxes.

**docdiff says my file is not supported.**
Follow the message. Usually you need to open the file in Word and save it as a `.docx`.

**Two paragraphs look identical but are marked as different.**
Look for small symbols: `·` (extra space), `°` (non-breaking space), curly vs straight quotes, or `-` vs `–`. You can hide these types in **View › Show differences in**.

**I changed the formatting but docdiff shows nothing.**
That is expected. Formatting is not compared (see [§5](#5-what-is-compared-and-what-is-not)).

**One edit shows up as many differences.**
When a whole chapter is moved, each heading and long paragraph is a separate move. Use **Batch** to handle a whole section at once.

**"Use old" is greyed out.**
Hover over *Use old unavailable* to see the reason. Make that change in Word after exporting.

**Word asks to update fields when I open the export.**
That is intended. Click **Yes**.

**The export says "does not fully match the preview".**
Cancel, and note which differences are listed. You can try different choices, or choose **Download anyway** and check those places carefully in Word. Please report the case (see below).

**Word reports unreadable content in the exported file.**
Do not use that file. Please report it together with the two original files, if you are allowed to share them.

**I lost my choices.**
If you saved a progress file, compare the same two files again and use **Progress › Load progress…**. Otherwise, reopen the same two files in the same browser and accept *Restore your previous choices?*. This works only if the browser storage was not cleared.

**Does docdiff send my documents anywhere?**
No. All reading, comparing and exporting happen inside your browser. The offline HTML file works with no network connection at all.

**Where do I report a problem?**
Contact the docdiff maintainer. Include the docdiff version (top-left corner), what you did, and what you expected to happen.

---

## 8. Quick reference

### Keyboard shortcuts

| Key | Action |
|---|---|
| `J` / `K` | Next / previous difference |
| `U` | Next unreviewed difference |
| `1` / `2` | Use old / Use new for the current difference |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |

### Choice status

| Status | Meaning |
|---|---|
| *Unreviewed · new by default* | No choice yet; the new version is used |
| *Using old* | The old version is used |
| *Using new* | The new version is used |
| *Mixed · chosen per change* | Some changes in this paragraph use old, others use new |
| *Info only* | Shown for information; cannot be chosen |

### Files docdiff creates

| File | Created by | Contains |
|---|---|---|
| `<new>_merged_YYYYMMDD.docx` | Export | The merged document |
| `<new>_review_YYYYMMDD.json` | Progress › Save progress | Your choices and document fingerprints (no document text) |
