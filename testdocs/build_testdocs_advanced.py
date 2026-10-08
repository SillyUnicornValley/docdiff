#!/usr/bin/env python3
"""More complex test pairs (08 and later) for docdiff.

Built with the primitives of build_testdocs.py. Run build_testdocs.py to
generate them (or `python3 build_testdocs.py --only=08,09` for a subset).
Expected results are listed in README.md.
"""
import random

from build_testdocs import (BOOKMARK, BR, CMT, DATE, FIELD, FLD_SIMPLE, FNREF, H1, H2, H3, INS, DEL, LANDSCAPE,
                            LETTER, LI, MARK_DEL, MARK_INS, P, PPR_CHANGE, R, TAB, TBL, TITLE, Doc, _next, _ra,
                            png)

W14 = ('xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
       'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"')
MATH = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
VML = 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"'

# ---------------------------------------------------------------- more primitives


def CRS(cid):
    """Start of a comment range (end it with CRE)."""
    return f'<w:commentRangeStart w:id="{cid}"/>'


def CRE(cid):
    return (f'<w:commentRangeEnd w:id="{cid}"/>'
            f'<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{cid}"/></w:r>')


def SDT(inner, alias, choice="", block=False, extra_pr=""):
    """Content control. inner: runs (inline) or paragraphs (block)."""
    sid = _next("bm") + 900000
    return (f'<w:sdt><w:sdtPr><w:alias w:val="{alias}"/><w:tag w:val="{alias.replace(" ", "")}"/>'
            f'<w:id w:val="{sid}"/>{choice}{extra_pr}</w:sdtPr><w:sdtContent>{inner}</w:sdtContent></w:sdt>')


def CHECKBOX(checked):
    mark = "☒" if checked else "☐"
    return SDT(f'<w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr><w:t>{mark}</w:t></w:r>',
               "Check box", extra_pr=f'<w14:checkbox><w14:checked w14:val="{1 if checked else 0}"/>'
               '<w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>')


def DROPDOWN(value, options):
    items = "".join(f'<w:listItem w:displayText="{o}" w:value="{o}"/>' for o in options)
    return SDT(R(value), "Phase", choice=f"<w:dropDownList>{items}</w:dropDownList>")


def DATEPICK(value):
    return SDT(R(value), "Approval date",
               choice=f'<w:date w:fullDate="{value}T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/><w:lid w:val="en-US"/>'
                      '<w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>')


def EQ(text):
    return f'<m:oMath><m:r><m:t>{text}</m:t></m:r></m:oMath>'


def TEXTBOX(text):
    n = _next("docpr")
    return (f'<w:r><w:pict><v:shape id="TextBox{n}" type="#_x0000_t202" style="width:220pt;height:36pt">'
            f'<v:textbox><w:txbxContent>{P(text)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>')


def ENREF(eid):
    return f'<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:endnoteReference w:id="{eid}"/></w:r>'


def SYM(char, font="Wingdings"):
    return f'<w:r><w:sym w:font="{font}" w:char="{char}"/></w:r>'


NB_HYPHEN = "<w:r><w:noBreakHyphen/></w:r>"
SOFT_HYPHEN = "<w:r><w:softHyphen/></w:r>"


def SEQ(n, ident="Table"):
    return FIELD(f"SEQ {ident} \\* ARABIC", R(str(n)))


def CAPTION(label, n, text, bm=None):
    inner = [R(f"{label} "), SEQ(n, label)]
    content = BOOKMARK(bm, inner) if bm else inner
    return P([content if isinstance(content, str) else "".join(inner), R(f". {text}")], style="Caption")


def NUM(abstract_id, num_id, fmt, text, font=None):
    rpr = f'<w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:hint="default"/></w:rPr>' if font else ""
    abstract = (f'<w:abstractNum w:abstractNumId="{abstract_id}"><w:multiLevelType w:val="hybridMultilevel"/>'
                f'<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{text}"/>'
                f'<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>{rpr}</w:lvl></w:abstractNum>')
    return abstract, f'<w:num w:numId="{num_id}"><w:abstractNumId w:val="{abstract_id}"/></w:num>'


def PAGE_X_OF_Y():
    return P(["Page ", FIELD("PAGE", R("1")), " of ", FIELD("NUMPAGES", R("1"))], style="Header", jc="center")


# ---------------------------------------------------------------- 08 export formatting

def case08_export_formatting():
    note = ('<w:style w:type="paragraph" w:customStyle="1" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/>'
            '<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>')
    dash_abs, dash_num = NUM(9, 6, "bullet", "–")
    old = Doc(styles_extra=note, num_extra_abstract=dash_abs, num_extra_num=dash_num)
    # The new file uses localized style ids (as Word does in other languages); names stay "heading 1/2".
    new = Doc(style_ids={"Heading1": "Ueberschrift1", "Heading2": "Ueberschrift2"})
    for d in (old, new):
        d.add(P(TITLE + " - Export Formatting", style="Title"), H1("Purpose"))

    c1 = new.comment("Agreed at the steering committee.")
    old.add(P("The sponsor must notify all sites within 10 business days of a protocol amendment."))
    new.add(P(["The ", R("sponsor", b=True), " must notify ", R("all", i=True), " sites within ", CRS(c1),
               R("5 business days", u=True), CRE(c1), " of a protocol amendment."]))
    old.add(P(["Storage temperature: ", R("15–25 °C", b=True, color="C00000"), " (room temperature)."]))
    new.add(P(["Storage temperature: ", R("2–8 °C", b=True, color="C00000"), " (refrigerated)."]))
    old.add(P(["The dose is 75 mg/m", R("2", sup=True), " given as a single infusion."]))
    new.add(P("The dose is 75 mg/m2 given as a single infusion."))
    old.add(P(["Exhaled CO", R("2", sub=True), " is measured at rest."]))
    new.add(P(["Exhaled CO", R("2", sub=True), " is measured at rest and after exercise."]))
    old.add(P(["Samples are frozen.", R(" DRAFT: confirm the freezer model.", vanish=True)]))
    new.add(P("Samples are frozen."))
    old.add(P(["Name:", TAB, "Jane Doe", BR, "Site:", TAB, "02"]))
    new.add(P(["Name:", TAB, "John Doe", BR, "Site:", TAB, "01"]))
    # one run per word, alternating formatting
    words_new = "Each participant will receive a diary card at the baseline visit and must return it at every scheduled visit thereafter.".split()
    old.add(P("Each participant will receive a paper diary at the baseline visit and must return it at each visit thereafter."))
    new.add(P([R(w + (" " if k < len(words_new) - 1 else ""), b=k % 3 == 0, i=k % 3 == 1, color="1F4E79" if k % 3 == 2 else None)
               for k, w in enumerate(words_new)]))

    for d in (old, new):
        d.add(H1("Notes and Retention"))
    old.add(P([R("Note:", b=True, color="2F5496", font="Arial"), " the pharmacy manual takes precedence over this section."],
              style="Note", jc="both"))
    for d in (old, new):
        d.add(P("Study records are retained according to local regulations."))
    old.add(H2("Retention Period"), P("Records will be kept for 15 years after study completion."))
    for d in (old, new):
        d.add(H2("Archiving"), P("Archived records are stored in a fire-proof facility."))

    for d in (old, new):
        d.add(H1("Diary Instructions"))
    items = ["Keep the diary dry.", "Record every dose.", "Bring the diary to each visit.", "Report missed doses."]
    old.add(*[LI(t, 2) for t in items])
    new.add(*[LI(t, 2) for t in items if t != "Record every dose."])
    for d in (old, new):
        d.add(P("Contact the site in these cases:"))
    old.add(*[LI(t, 6) for t in ["You feel unwell.", "You miss two doses in a row."]])  # list definition only in the old file
    for d in (old, new):
        d.add(P("Return unused medication at the final visit."))
    old.add(*[LI(t, 5) for t in ["Count the tablets.", "Seal the bottle.", "Hand it to the pharmacist."]])
    for d in (old, new):
        d.add(P("Thank you for taking part in the study."))

    for d in (old, new):
        d.add(H1("Bookmarks and Comments"))
    old.add(P(["See the ", BOOKMARK("_RefContact", R("safety contact")), " for urgent questions."]))
    new.add(P(["See the ", BOOKMARK("_RefContact", R("medical monitor")), " for urgent questions."]))
    c2 = new.comment("Comment on an inserted paragraph.")
    new.add(P([BOOKMARK("_Toc900", R("This inserted paragraph carries a bookmark and ")), CRS(c2), R("a comment"), CRE(c2), "."]))
    c3 = new.comment("Comment spanning an inserted and an existing paragraph.")
    new.add(P([CRS(c3), R("This inserted paragraph starts a commented passage.")]))
    old.add(P("This paragraph ends the passage."))
    new.add(P([R("This paragraph ends the passage."), CRE(c3)]))
    return old, new


# ---------------------------------------------------------------- 09 sections, headers, footers

def case09_sections():
    old, new = Doc(), Doc(even_odd=True)
    for d, ver in ((old, "1.0"), (new, "2.0")):
        d.h_main = d.add_hf("header", f"CX-201 Protocol v{ver} - Confidential")
        d.h_cover = d.add_hf("header", "CX-201 - Cover page")
        d.f_page = d.add_hf("footer", PAGE_X_OF_Y())
        d.h_land = d.add_hf("header", "CX-201 - Schedule (landscape)" if ver == "1.0" else "CX-201 v2.0 - Schedule (landscape)")
    old.h_refs = old.add_hf("header", "CX-201 v1.0 - References")
    new.h_odd = new.add_hf("header", "CX-201 v2.0 - Appendix B (odd pages)")
    new.h_even = new.add_hf("header", "CX-201 v2.0 - Appendix B (even pages)")

    for d, date in ((old, "2026-01-15"), (new, "2026-09-30")):
        d.add(P(TITLE, style="Title"), P("Version " + ("1.0" if d is old else "2.0")))
        d.add(P(f"Date: {date}", sect=d.sect(hdr={"default": d.h_main, "first": d.h_cover}, ftr={"default": d.f_page}, title_pg=True)))
        d.add(H1("Introduction"), P("Hypertension is a leading risk factor for cardiovascular disease."))
    old.add(P("This protocol describes a 12-week study."))
    new.add(P("This protocol describes a 24-week study."))
    # new: a continuous two-column section for key points
    new.add(P("Key points follow.", sect=new.sect(hdr={"default": new.h_main}, ftr={"default": new.f_page})))
    new.add(LI("Randomized and double-blind.", 2), LI("Two treatment arms.", 2),
            LI("Primary endpoint at Week 24.", 2, sect=new.sect(sect_type="continuous", cols=2)))
    for d in (old, new):
        d.add(P("The study is sponsored by Acme Pharma Ltd.",
                sect=d.sect(hdr={"default": d.h_main}, ftr={"default": d.f_page}) if d is old else d.sect(sect_type="continuous")))
        d.add(H1("Schedule of Activities"))
    sched = lambda w12: [["Visit", "Screening", "Baseline", "Week 4", "Week 12", "Week 24", "Follow-up"],
                         ["Informed consent", "X", "", "", "", "", ""],
                         ["Vital signs", "X", "X", "X", "X", "X", "X"],
                         ["ECG", "X", "", "", w12, "X", ""]]
    old.add(TBL(sched("X"), [2600, 1500, 1500, 1500, 1500, 1500, 1500]))
    new.add(TBL(sched(""), [2600, 1500, 1500, 1500, 1500, 1500, 1500]))
    for d in (old, new):
        d.add(P("X = assessment performed.",
                sect=d.sect(page=LANDSCAPE, hdr={"default": d.h_land}, ftr={"default": d.f_page})))
    # old: a References section (portrait, own header) that the new file removes
    old.add(H1("References"), P("1. Whelton PK, et al. Hypertension guideline. 2017."), P("2. Williams B, et al. ESC/ESH guideline. 2018."))
    old.final_sect = old.sect(hdr={"default": old.h_refs}, ftr={"default": old.f_page})
    # new: Appendix B with odd/even headers instead
    new.add(H1("Appendix B. Blood Pressure Technique"), P("Use an appropriately sized cuff."),
            P("Take three readings one minute apart."))
    new.final_sect = new.sect(hdr={"default": new.h_odd, "even": new.h_even}, ftr={"default": new.f_page})
    return old, new


# ---------------------------------------------------------------- 10 complex tables

def case10_tables():
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Complex Tables", style="Title"))
    W4 = [2000, 2200, 2200, 2000]

    # A. two header rows with a horizontal merge
    def dose(rows):
        head = [["Cohort", {"c": "Dose", "span": 2}, "N"], ["", "mg", "mg/kg", ""]]
        return TBL(head + rows, W4)
    for d in (old, new):
        d.add(H1("A. Merged header"))
    old.add(dose([["1", "10", "0.15", "6"], ["2", "20", "0.3", "6"], ["3", "40", "0.6", "6"], ["4", "80", "1.2", "6"]]))
    new.add(dose([["0", "5", "0.08", "3"], ["1", "10", "0.15", "6"], ["2", "20", "0.3", "9"], ["4", "80", "1.2", "6"],
                  ["5", "120", "1.8", "6"]]))

    # B. vertically merged category column, text edits only
    M = lambda t: {"c": t, "vmerge": "restart"}
    C = {"c": None, "vmerge": "cont"}
    for d in (old, new):
        d.add(H1("B. Vertical merge"))
    old.add(TBL([["Category", "Test", "Limit"], [M("Hematology"), "Hemoglobin", "Hb < 10 g/dL"], [C, "Platelets", "Plt < 100"],
                 [M("Liver"), "ALT", "> 3 x ULN"], [C, "Bilirubin", "> 2 x ULN"]], [2600, 3000, 3000]))
    new.add(TBL([["Category", "Test", "Limit"], [M("Haematology"), "Hemoglobin", "Hb < 9 g/dL"], [C, "Platelets", "Plt < 100"],
                 [M("Liver"), "ALT", "> 3 x ULN"], [C, "Total bilirubin", "> 2 x ULN"]], [2600, 3000, 3000]))

    # C. a column removed
    for d in (old, new):
        d.add(H1("C. Column removed"))
    old.add(TBL([["Visit", "Day", "Window", "Fasting", "Notes"], ["Screening", "-28", "-", "Yes", ""],
                 ["Baseline", "1", "-", "Yes", "Randomize"], ["Week 4", "29", "±3", "No", ""]], [1800, 1200, 1400, 1400, 2800]))
    new.add(TBL([["Visit", "Day", "Window", "Notes"], ["Screening", "-28", "-", ""],
                 ["Baseline", "1", "-", "Randomize"], ["Week 4", "29", "±3", ""]], [2200, 1600, 1800, 3000]))

    # D. a cell with several paragraphs and a list
    for d in (old, new):
        d.add(H1("D. Rich cell"))
    old.add(TBL([["Step", "Instructions"], ["Sampling", [P("Collect:"), LI("blood", 2), LI("urine", 2), P("Ship on dry ice.")]],
                 ["Storage", "Keep at -80 °C."]], [2400, 6000]))
    new.add(TBL([["Step", "Instructions"], ["Sampling", [P("Collect:"), LI("blood", 2), LI("urine", 2), LI("saliva", 2),
                                                          P("Ship at -20 °C.")]],
                 ["Storage", "Keep at -80 °C."]], [2400, 6000]))

    # E. nested table with a row added inside
    for d in (old, new):
        d.add(H1("E. Nested table"))
    inner_old = TBL([["Window", "Days"], ["Week 4", "±3"], ["Week 12", "±7"]], [1800, 1800])
    inner_new = TBL([["Window", "Days"], ["Week 4", "±3"], ["Week 8", "±5"], ["Week 12", "±7"]], [1800, 1800])
    for d, inner in ((old, inner_old), (new, inner_new)):
        d.add(TBL([["Item", "Details"], ["Visit windows", [P("Relative to baseline:"), inner]], ["Unscheduled", "Allowed"]],
                  [2400, 6000]))

    # F. a long definitions table: renamed, removed, added and reordered rows
    terms = [(f"Term {k:02d}", f"Definition of term {k:02d} used throughout this protocol.") for k in range(1, 26)]
    old_rows = [list(t) for t in terms]
    new_rows = [list(t) for t in terms]
    new_rows[3][0] = "Term 04 (revised)"
    new_rows[10][1] = "Updated definition of term 11, now aligned with ICH E6(R3)."
    del new_rows[15]
    new_rows.insert(20, ["Term 21a", "A new term added in version 2."])
    new_rows.append(["Term 26", "Another new term at the end."])
    new_rows[5], new_rows[7] = new_rows[7], new_rows[5]
    for d, rows in ((old, old_rows), (new, new_rows)):
        d.add(H1("F. Definitions"))
        d.add(TBL([["Term", "Definition"]] + rows, [2400, 6000]))

    # G/H. a table removed, another added
    for d in (old, new):
        d.add(H1("G. Removed and added tables"))
    old.add(TBL([["Abbreviation", "Meaning"], ["BP", "Blood pressure"], ["HR", "Heart rate"]], [3000, 5400]))
    for d in (old, new):
        d.add(P("Text between the tables."))
    new.add(TBL([["Contact", "Phone"], ["Medical monitor", "+1 555 0100"], ["Pharmacovigilance", "+1 555 0199"]], [3000, 5400]))

    # I. same content, only shading and widths differ
    for d in (old, new):
        d.add(H1("I. Formatting only"))
    old.add(TBL([["Arm", "Treatment"], ["A", "Compound X 10 mg"], ["B", "Placebo"]], [3000, 5400]))
    new.add(TBL([["Arm", "Treatment"], [{"c": "A", "shade": "E2EFDA"}, "Compound X 10 mg"], ["B", "Placebo"]], [2600, 5800]))

    # J. one table split into two
    for d in (old, new):
        d.add(H1("J. Split table"))
    rows = [[f"Visit {k}", f"Day {k * 14}"] for k in range(1, 9)]
    old.add(TBL([["Visit", "Day"]] + rows, [4200, 4200]))
    new.add(TBL([["Visit", "Day"]] + rows[:4], [4200, 4200]), P("Treatment period ends here."),
            TBL([["Visit", "Day"]] + rows[4:], [4200, 4200]))

    # K. wide table with empty cells
    for d in (old, new):
        d.add(H1("K. Wide table"))
    hdr = ["Assessment"] + [f"V{k}" for k in range(1, 8)]
    old.add(TBL([hdr, ["Weight", "X", "", "", "X", "", "", "X"], ["Height", "X", "", "", "", "", "", ""],
                 ["PK sample", "", "X", "X", "–", "X", "", ""]], [2000] + [900] * 7))
    new.add(TBL([hdr, ["Weight", "X", "", "X", "X", "", "", "X"], ["Height", "X", "", "", "", "", "", ""],
                 ["PK sample", "", "X", "", "–", "X", "X", ""]], [2000] + [900] * 7))
    for d in (old, new):
        d.add(P("End of tables."))
    return old, new


# ---------------------------------------------------------------- 11 fields and content controls

def case11_fields_controls():
    old, new = Doc(ns_extra=f"{W14} {MATH} {VML}"), Doc(ns_extra=f"{W14} {MATH} {VML}")
    for d, ver in ((old, "1.0"), (new, "2.0")):
        d.h = d.add_hf("header", P([f"CX-201 v{ver} - printed ", FIELD('DATE \\@ "yyyy-MM-dd"', R("2026-01-15" if ver == "1.0" else "2026-09-30"))],
                                   style="Header"))
        d.final_sect = d.sect(hdr={"default": d.h})
    old.add(SDT(P(TITLE + " - Fields and Controls", style="Title"), "Study title", block=True))
    new.add(SDT(P(TITLE + " - Fields and Content Controls", style="Title"), "Study title", block=True))

    for d in (old, new):
        d.add(H1("Content Controls"))
    old.add(SDT(P("The sponsor confirms that this protocol follows ICH E6.") + P("The sponsor will provide insurance cover."),
                "Sponsor statement", block=True))
    new.add(SDT(P("The sponsor confirms that this protocol follows ICH E6.") + P("The sponsor will provide insurance cover for all sites."),
                "Sponsor statement", block=True))
    old.add(P(["Protocol number: ", SDT(R("CX-201"), "Protocol number", choice="<w:text/>")]))
    new.add(P(["Protocol number: ", SDT(R("CX-201-A"), "Protocol number", choice="<w:text/>")]))
    old.add(P([CHECKBOX(False), " Not applicable (no biological samples are stored)"]))
    new.add(P([CHECKBOX(True), " Not applicable (no biological samples are stored)"]))
    old.add(P(["Phase: ", DROPDOWN("Phase 2", ["Phase 1", "Phase 2", "Phase 3"])]))
    new.add(P(["Phase: ", DROPDOWN("Phase 3", ["Phase 1", "Phase 2", "Phase 3"])]))
    old.add(P(["Approved on ", DATEPICK("2026-01-15"), "."]))
    new.add(P(["Approved on ", DATEPICK("2026-09-30"), "."]))
    old.add(P(["The study runs in ", '<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="City"><w:r><w:t>Boston</w:t></w:r></w:smartTag>', " and Denver."]))
    new.add(P(["The study runs in ", '<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="City"><w:r><w:t>Chicago</w:t></w:r></w:smartTag>', " and Denver."]))
    for d in (old, new):
        d.add(P(["Completed checklist ", SYM("F0FC"), " signed by the investigator."]))

    for d in (old, new):
        d.add(H1("Captions and Cross-references"))
    new.add(CAPTION("Table", 1, "Dosing"), TBL([["Dose", "Frequency"], ["10 mg", "Once daily"]], [4200, 4200]))
    for d, base in ((old, 1), (new, 2)):
        d.add(CAPTION("Table", base, "Visits", bm="_RefVisits"), TBL([["Visit", "Day"], ["Baseline", "1"]], [4200, 4200]))
        d.add(CAPTION("Table", base + 1, "Laboratory tests", bm="_RefLabs"), TBL([["Test", "Unit"], ["ALT", "U/L"]], [4200, 4200]))
        d.add(P(["Laboratory tests are listed in ", FIELD("REF _RefLabs \\h", R(f"Table {base + 1}")), " on page ",
                 FIELD("PAGEREF _RefLabs \\h", R(str(base + 2))), "."]))

    for d in (old, new):
        d.add(H1("Links and Notes"))
    old.add(P(["More information is on the ", old.hyperlink("https://example.com/cx201", "study website"), "."]))
    new.add(P(["More information is on the ", new.hyperlink("https://example.com/cx201", "trial portal"), "."]))
    for d in (old, new):
        d.add(P(["The device manual is on the ", d.hyperlink("https://example.com/manual-" + ("v1" if d is old else "v2"), "device page"), "."]))
    f_old = old.footnote("Validated per ISO 81060-2.")
    old.add(P(["Blood pressure is measured with a validated device.", FNREF(f_old)]))
    new.add(P("Blood pressure is measured with a validated device."))
    f_new = new.footnote("Mean of three readings.")
    old.add(P("Office blood pressure is the primary measure."))
    new.add(P(["Office blood pressure is the primary measure.", FNREF(f_new)]))
    e_old, e_new = old.endnote("See the pharmacy manual, version 1."), new.endnote("See the pharmacy manual, version 3.")
    old.add(P(["Study drug is dispensed by the site pharmacy.", ENREF(e_old)]))
    new.add(P(["Study drug is dispensed by the site pharmacy.", ENREF(e_new)]))

    for d in (old, new):
        d.add(H1("Objects"))
    old.add(P(["Body mass index: ", EQ("BMI = weight / height^2")]))
    new.add(P(["Body mass index: ", EQ("BMI = mass / height^2")]))
    old.add(P(["Reminder box: ", TEXTBOX("Fast for 8 hours before the visit.")]))
    new.add(P(["Reminder box: ", TEXTBOX("Fast for 10 hours before the visit.")]))
    old.add(P(old.image(png(48, 24, (40, 160, 40))), jc="center"))
    new.add(P(new.image(png(48, 24, (40, 160, 40))), jc="center"))

    for d in (old, new):
        d.add(H1("Field Across Paragraphs"))
    begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> QUOTE "Multi-line field" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    old.add(P([begin, R("Field result line one,")]), P([R("field result line two."), end]))
    new.add(P([begin, R("Field result line one,")]), P([R("field result line two (edited)."), end]))
    for d in (old, new):
        d.add(P("End of document."))
    return old, new


# ---------------------------------------------------------------- 12 tracked changes and comments mixed

def case12_tracked_comments():
    C, D_, E = "Carol (old)", "Dan (new)", "Erin (new)"
    old, new = Doc(), Doc()
    for d in (old, new):
        d.h = d.add_hf("header", P(["CX-201 ", INS("v2.0 ", E) if d is new else "", "- Confidential"], style="Header"))
        d.final_sect = d.sect(hdr={"default": d.h})
        d.add(P(TITLE + " - Revisions and Comments", style="Title"), H1("Objectives"))
    # two authors and a comment on inserted text
    cc = old.comment("Old file comment (Carol).", "Carol", "C")
    old.add(P(["The primary objective is to compare ", CRS(cc), DEL("systolic", C), INS("mean systolic", C), CRE(cc), " blood pressure."]))
    c1 = new.comment("Is 'seated' needed?", "Dan", "D")
    new.add(P(["The primary objective is to compare mean ", CRS(c1), INS("seated ", D_), CRE(c1), "systolic blood pressure",
               DEL(" at Week 12", E), INS(" at Week 24", E), "."]))
    # overlapping comments
    c2, c3 = new.comment("Overlap A", "Dan", "D"), new.comment("Overlap B", "Erin", "E")
    old.add(P("Secondary objectives include diastolic blood pressure and response rate."))
    new.add(P([R("Secondary "), CRS(c2), R("objectives include "), CRS(c3), R("diastolic blood pressure"), CRE(c2),
               R(" and response rate"), CRE(c3), R(".")]))

    for d in (old, new):
        d.add(H1("Procedures"))
    # paragraph-mark deletion that joins two list items
    old.add(LI("Measure blood pressure.", 1), LI("Record heart rate.", 1), LI("Collect urine.", 1))
    new.add(LI("Measure blood pressure", 1, mark=MARK_DEL(D_)), LI([INS(" and ", D_), "record heart rate."], 1), LI("Collect urine.", 1))
    # a two-paragraph block moved with tracked moves
    block = ["Participants rest for five minutes before measurement.", "The arm is supported at heart level."]
    old.add(*[P(t) for t in block], P("Three readings are taken."), P("The mean is recorded."))
    mid = _next("rev")
    new.add(P(f'<w:moveFromRangeStart w:id="{mid}" w:author="{E}" w:date="{DATE}" w:name="moveB"/><w:moveFrom {_ra(E)}>{R(block[0])}</w:moveFrom>',
              mark=f"<w:moveFrom {_ra(E)}/>"),
            P(f'<w:moveFrom {_ra(E)}>{R(block[1])}</w:moveFrom><w:moveFromRangeEnd w:id="{mid}"/>', mark=f"<w:moveFrom {_ra(E)}/>"),
            P("Three readings are taken."))
    mid2 = _next("rev")
    new.add(P(f'<w:moveToRangeStart w:id="{mid2}" w:author="{E}" w:date="{DATE}" w:name="moveB"/><w:moveTo {_ra(E)}>{R(block[0])}</w:moveTo>',
              mark=f"<w:moveTo {_ra(E)}/>"),
            P(f'<w:moveTo {_ra(E)}>{R(block[1])}</w:moveTo><w:moveToRangeEnd w:id="{mid2}"/>', mark=f"<w:moveTo {_ra(E)}/>"),
            P("The mean is recorded."))
    # style change (tracked) and formatting change
    old.add(P("Safety Assessments"))
    new.add(P("Safety Assessments", style="Heading2", ppr_change=PPR_CHANGE(D_, "Normal")))
    for d in (old, new):
        d.add(P(["Adverse events are coded with ", R("MedDRA", b=True, rpr_change=D_ if d is new else None), "."]))

    for d in (old, new):
        d.add(H1("Tables with Revisions"))
    c4 = new.comment("Check the unit.", "Erin", "E")
    old.add(TBL([["Test", "Unit", "Range"], ["Glucose", "mg/dL", "70-99"], ["Sodium", "mmol/L", "135-145"], ["Urea", "mg/dL", "7-20"]],
                [3000, 2700, 2700]))
    new.add(TBL([["Test", "Unit", "Range"],
                 ["Glucose", [P([CRS(c4), DEL("mg/dL", D_), INS("mmol/L", D_), CRE(c4)])], [P([DEL("70-99", D_), INS("3.9-5.5", D_)])]],
                 {"cells": [[P([INS("Potassium", E)], mark=MARK_INS(E))], [P([INS("mmol/L", E)], mark=MARK_INS(E))],
                            [P([INS("3.5-5.0", E)], mark=MARK_INS(E))]], "trpr": MARK_INS(E)},
                 ["Sodium", "mmol/L", "135-145"],
                 {"cells": [[P([DEL("Urea", E)], mark=MARK_DEL(E))], [P([DEL("mg/dL", E)], mark=MARK_DEL(E))],
                            [P([DEL("7-20", E)], mark=MARK_DEL(E))]], "trpr": MARK_DEL(E)}],
                [3000, 2700, 2700]))
    # a tracked cell insertion: not supported, reported in the check scope
    old.add(TBL([["Visit", "Day"], ["Baseline", "1"]], [4200, 4200]))
    new.add(TBL([["Visit", "Day"], ["Baseline", {"c": "1", "extra": f"<w:cellIns {_ra(D_)}/>"}]], [4200, 4200]))

    for d in (old, new):
        d.add(H1("Comments across Paragraphs"))
    c5 = new.comment("This passage needs a medical review.", "Dan", "D")
    old.add(P("Participants may withdraw at any time."), P("Withdrawn participants are not replaced."),
            P("Data collected before withdrawal are kept."))
    new.add(P([CRS(c5), R("Participants may withdraw at any time.")]),
            P("Withdrawal reasons are recorded in the eCRF."),
            P([R("Data collected before withdrawal are kept."), CRE(c5)]))
    c6 = new.comment("New paragraph: please confirm.", "Erin", "E")
    new.add(P([CRS(c6), R("Sites must report withdrawals within 7 days."), CRE(c6)]))
    f = new.footnote("Footnote with a tracked change.")
    for d in (old, new):
        d.add(P(["Withdrawal does not affect standard care.", FNREF(f) if d is new else ""]))
    return old, new


# ---------------------------------------------------------------- 13 reordering and repeated text

def case13_reorder():
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Reordering and Repetition", style="Title"))
    chapters = {
        "Background": ["Hypertension affects one in three adults.", "Many patients remain uncontrolled despite treatment.",
                       "Compound X is a novel aldosterone synthase inhibitor."],
        "Rationale": ["Aldosterone excess contributes to resistant hypertension.", "Selective inhibition may avoid cortisol effects.",
                      "Phase 1 data support once-daily dosing."],
        "Risks and Benefits": ["Hyperkalemia is the main expected risk.", "Potassium will be monitored at every visit.",
                               "The expected benefit is a reduction in blood pressure."],
        "Population": ["Adults aged 18 to 75 years are eligible.", "Participants must have uncontrolled hypertension.",
                       "Pregnant women are excluded."],
    }
    order_old = ["Background", "Rationale", "Risks and Benefits", "Population"]
    order_new = ["Background", "Population", "Rationale", "Risks and Benefits"]  # a whole chapter moved up
    for d, order in ((old, order_old), (new, order_new)):
        for ch in order:
            d.add(H1(ch), H2("Overview"))
            paras = list(chapters[ch])
            if d is new and ch == "Rationale":
                paras[0], paras[1] = paras[1], paras[0]  # two paragraphs swapped
            if d is new and ch == "Risks and Benefits":
                paras[1] = "Serum potassium will be monitored at every scheduled visit."  # moved chapter, edited
            for t in paras:
                d.add(P(t))
            d.add(P("See Section 9 for details."))
    for d in (old, new):
        d.add(H1("Not Applicable Sections"))
    for s in ["Pharmacogenomics", "Pediatric plan", "Device sub-study", "Imaging", "Biobanking", "Home visits"]:
        old.add(H2(s), P("Not applicable."))
        if s != "Imaging":
            new.add(H2(s), P("Not applicable."))
    for d in (old, new):
        d.add(H1("Visit Schedule"))
    for k in range(1, 13):
        old.add(P(f"Visit {k} takes place on Day {k * 7}."))
        new.add(P(f"Visit {k} takes place on Day {k * 7 + (1 if k == 9 else 0)}."))
    for d in (old, new):
        d.add(H1("Instructions"))
    steps = ["Arrive fasting.", "Bring your diary.", "Bring all medication.", "Wear short sleeves.", "Avoid caffeine.",
             "Rest before the visit."]
    old.add(*[LI(s, 1) for s in steps])
    new.add(*[LI(s, 1) for s in [steps[k] for k in (2, 0, 1, 5, 3, 4)]])
    for d in (old, new):
        d.add(H1("Moved and Edited"))
    moved_old = "Unblinding is only permitted when knowledge of treatment is essential for the participant's medical care."
    moved_new = "Unblinding is only permitted when knowledge of the treatment is essential for the participant's urgent medical care."
    old.add(P(moved_old), P("Study drug is packaged identically."), P("The IRT system holds the code."), P("Short note."))
    new.add(P("Study drug is packaged identically."), P("Short note."), P("The IRT system holds the code."), P(moved_new))
    return old, new


# ---------------------------------------------------------------- 14 unicode and normalisation

def case14_unicode():
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Characters and Normalisation", style="Title"), H1("Symbols"))
    pairs = [
        ("Doses of 5 µg/kg ± 10% are allowed; the limit is ≥ 2 °C.", "Doses of 5 µg/kg ± 15% are allowed; the limit is ≥ 2 °C."),
        ("Use an α-blocker or β-blocker; resistance is 10 Ω.", "Use an α-blocker or a β-blocker; resistance is 10 Ω."),
        ("The naïve cohort met at the café in Zürich.", "The naive cohort met at the cafe in Zürich."),
        ("Status: approved ✅ by the committee 😀.", "Status: approved ✅ by the committee 🙂."),
        ("Investigator: 王小明 (Beijing site).", "Investigator: 王小明 (Shanghai site)."),
        ("Compound X™ and Device Y® are trademarks.", "Compound X™ and Device Y® are trademarks."),
    ]
    for a, b in pairs:
        old.add(P(a))
        new.add(P(b))
    for d in (old, new):
        d.add(H1("Spaces and Dashes"))
    space_pairs = [
        ("Take 10 mg daily.", "Take 10 mg daily."),                        # non-breaking space
        ("Take 20 mg daily.", "Take 20 mg daily."),                        # narrow no-break space
        ("A double  space here.", "A double space here."),
        ("Trailing space at the end. ", "Trailing space at the end."),
        ("Range 2-8 hours.", "Range 2–8 hours."),
        ("Pause -- then continue.", "Pause — then continue."),
        ("Wait...", "Wait…"),
        ("The participant's diary.", "The participant’s diary."),
        ('He said "stop".', "He said “stop”."),
        ("Zero​width space inside a word.", "Zerowidth space inside a word."),
        ("CASE CHANGE in this sentence.", "Case change in this sentence."),
        ("Column\tseparated\tvalues.", "Column separated values."),
    ]
    for a, b in space_pairs:
        old.add(P(a))
        new.add(P(b))
    for d in (old, new):
        d.add(H1("Special Word Elements"))
    old.add(P(["Long", SOFT_HYPHEN, "word with a soft hyphen."]))
    new.add(P("Longword with a soft hyphen."))
    old.add(P(["Non", NB_HYPHEN, "breaking hyphen element."]))
    new.add(P("Non-breaking hyphen element."))
    old.add(P(["Ticked ", SYM("F0FC"), " item."]))
    new.add(P(["Ticked ", SYM("F0FB"), " item."]))
    old.add(P(["Volume 10", R("3", sup=True), " cells."]))
    new.add(P("Volume 10³ cells."))
    for d in (old, new):
        d.add(H1("Long Paragraph"))
    rng = random.Random(14)
    words = ("the participant will attend each visit and the investigator records all findings in the source "
             "documents before entering data into the electronic case report form within five working days").split()
    text = " ".join(rng.choice(words) for _ in range(400))
    ws = text.split(" ")
    ws_new = list(ws)
    ws_new[50], ws_new[200], ws_new[350] = "Monday", "seven", "promptly"
    old.add(P(" ".join(ws).capitalize() + "."))
    new.add(P(" ".join(ws_new).capitalize() + "."))
    return old, new


# ---------------------------------------------------------------- 15 realistic SOP, v1.0 -> v2.0

def case15_sop():
    """A medium, realistic document with typical version-update edits. Changes are logged."""
    log = []
    HN = 4  # numbered headings (1, 1.1)

    def build(v2):
        d = Doc(header=None)
        ver, date = ("2.0", "2026-09-30") if v2 else ("1.0", "2025-11-03")
        d.h = d.add_hf("header", P([f"SOP-DM-014 Data Cleaning   Version {ver}", TAB, "Effective: ", R(date)], style="Header"))
        d.fp = d.add_hf("footer", PAGE_X_OF_Y())
        d.add(P("Standard Operating Procedure", style="Title"), P("Data Cleaning and Query Management", style="Title"))
        d.add(TBL([["Document", "SOP-DM-014"], ["Version", ver], ["Effective date", date], ["Owner", "Data Management"]],
                  [3000, 5400], header=False))
        hist = [["Version", "Date", "Author", "Summary"], ["1.0", "2025-11-03", "J. Lee", "First issue."]]
        if v2:
            hist.append(["2.0", "2026-09-30", "M. Ortiz", "Query timelines, roles and the review checklist updated."])
        d.add(H1("Revision History", num=None), TBL(hist, [1200, 1600, 1800, 3800]))
        tabs = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs>'
        toc = [("1 Purpose", 3), ("2 Scope", 3), ("3 Definitions", 3), ("4 Responsibilities", 4), ("5 Procedure", 5),
               ("6 References", 8)] + ([("7 Appendix: Checklist", 9)] if v2 else [("7 Appendix: Forms", 9)])
        for k, (t, pg) in enumerate(toc):
            content = [R(t), TAB, R(str(pg))]
            if k == 0:
                content = [FIELD('TOC \\o "1-2" \\h \\z \\u', "")[:-len('<w:r><w:fldChar w:fldCharType="end"/></w:r>')]] + content
            d.add(P(content, style="TOC1", tabs=tabs))
        d.add(P('<w:r><w:fldChar w:fldCharType="end"/></w:r>'))

        d.add(H1("Purpose", num=(HN, 0)))
        d.add(P("This SOP describes how clinical data are reviewed, cleaned and locked in the electronic data capture system"
                + (" and in external data sources." if v2 else ".")))
        d.add(H1("Scope", num=(HN, 0)))
        d.add(P("This SOP applies to all interventional studies managed by Data Management."))
        if not v2:
            d.add(P("Observational studies are out of scope."))
        d.add(H1("Definitions", num=(HN, 0)))
        defs = [["Term", "Definition"], ["EDC", "Electronic data capture system."], ["Query", "A request to clarify a data point."],
                ["SDV", "Source data verification."], ["DMP", "Data management plan."]]
        if v2:
            defs[2][1] = "A request to a site to clarify or correct a data point."
            defs.insert(4, ["RBQM", "Risk-based quality management."])
        d.add(TBL(defs, [2000, 6400]))
        d.add(H1("Responsibilities", num=(HN, 0)))
        roles = [("Data Manager", "Reviews data and raises queries."), ("Clinical Research Associate", "Supports sites in resolving queries."),
                 ("Investigator", "Answers queries and signs the casebook.")]
        if v2:
            roles[1] = ("Clinical Research Associate", "Supports sites in resolving queries within the agreed timelines.")
            roles.append(("Central Monitor", "Reviews key risk indicators every month."))
        for r, t in roles:
            d.add(P([R(r + ": ", b=True), t]))
        d.add(H1("Procedure", num=(HN, 0)))
        d.add(H2("Data Review", num=(HN, 1)))
        steps = ["Run the edit checks after each data transfer.", "Review listings for outliers.",
                 "Raise a query for each discrepancy.", "Close queries after the site answers."]
        if v2:
            steps.insert(2, "Check external data (laboratory, ECG) against the EDC.")
            steps[3] = "Raise one query per discrepancy, quoting the field name."
        for s in steps:
            d.add(LI(s, 1))
        fn = d.footnote("Outliers are values beyond 3 standard deviations." if v2 else "Outliers are values beyond 3 SD.")
        d.add(P(["Outlier review is documented in the data review log.", FNREF(fn)]))
        d.add(H2("Query Timelines", num=(HN, 1)))
        d.add(P(f"Sites must answer queries within {10 if v2 else 14} calendar days."))
        d.add(P(f"Unanswered queries are escalated to the CRA after {15 if v2 else 21} days."))
        if v2:
            d.add(P("Escalations are summarized in the monthly study report."))
        d.add(H2("Database Lock", num=(HN, 1)))
        lock = ["All queries are closed.", "SDV is complete.", "Medical coding is approved.", "The lock checklist is signed."]
        if v2:
            lock.remove("SDV is complete.")
            lock.insert(1, "Targeted SDV is complete according to the monitoring plan.")
        for s in lock:
            d.add(LI(s, 5))
        d.add(P(d.image(png(60, 30, (90, 90, 160))), jc="center"))
        d.add(P(["Figure ", SEQ(1, "Figure"), ". Query workflow."], style="Caption", jc="center"))
        d.add(H1("References", num=(HN, 0)))
        refs = ["ICH E6(R2) Good Clinical Practice.", "SOP-DM-010 Data Management Plan."]
        if v2:
            refs[0] = "ICH E6(R3) Good Clinical Practice."
            refs.append("SOP-CM-003 Central Monitoring.")
        for s in refs:
            d.add(P(s))
        d.add(P("Signatures follow.", sect=d.sect(hdr={"default": d.h}, ftr={"default": d.fp})))
        d.add(H1("Appendix: " + ("Checklist" if v2 else "Forms"), num=(HN, 0)))
        cl = [["Item", "Done", "Initials", "Date"], ["Edit checks run", "", "", ""], ["Listings reviewed", "", "", ""],
              ["Queries closed", "", "", ""]]
        if v2:
            cl.insert(2, ["External data reconciled", "", "", ""])
        d.add(TBL(cl, [5200, 1400, 1800, 2400]))
        d.add(P("Signatures:"))
        d.add(TBL([["Role", "Name", "Signature", "Date"], ["Author", "M. Ortiz" if v2 else "J. Lee", "", ""],
                   ["Approver", "K. Patel", "", ""]], [2400, 3000, 3000, 2000]))
        d.final_sect = d.sect(page=LANDSCAPE, hdr={"default": d.h}, ftr={"default": d.fp})
        return d

    log += [
        "HEADER  version 1.0 -> 2.0 and effective date (not compared; Check scope hint)",
        "CELL    title table: Version 1.0 -> 2.0; Effective date 2025-11-03 -> 2026-09-30",
        "ROW+    revision history: row for version 2.0",
        "TOC     entry 7 'Appendix: Forms' -> 'Appendix: Checklist' (TOC folded; shown with 'Compare table of contents')",
        "MODIFY  Purpose: '…capture system.' -> '…capture system and in external data sources.'",
        "DELETE  Scope: 'Observational studies are out of scope.'",
        "CELL    definitions: Query definition reworded",
        "ROW+    definitions: RBQM row",
        "MODIFY  Responsibilities: CRA sentence extended",
        "INSERT  Responsibilities: Central Monitor",
        "INSERT  Data Review step 'Check external data (laboratory, ECG) against the EDC.'",
        "MODIFY  Data Review step 'Raise a query…' -> 'Raise one query per discrepancy, quoting the field name.' (rewritten: shown as delete + insert)",
        "FOOTNOTE text changed (not compared; Check scope hint)",
        "MODIFY  Query Timelines: 14 -> 10 calendar days",
        "MODIFY  Query Timelines: 21 -> 15 days",
        "INSERT  Query Timelines: 'Escalations are summarized…'",
        "DELETE  Database Lock: 'SDV is complete.'",
        "INSERT  Database Lock: 'Targeted SDV is complete…' (G5: may pair with the deleted item as one modification)",
        "MODIFY  References: ICH E6(R2) -> ICH E6(R3)",
        "INSERT  References: SOP-CM-003",
        "MODIFY  Appendix heading 'Forms' -> 'Checklist'",
        "ROW+    checklist: External data reconciled",
        "CELL    signatures: Author J. Lee -> M. Ortiz",
    ]
    return build(False), build(True), log


ADVANCED_CASES = [
    ("08-export-formatting", case08_export_formatting),
    ("09-sections-headers", case09_sections),
    ("10-complex-tables", case10_tables),
    ("11-fields-and-controls", case11_fields_controls),
    ("12-tracked-and-comments", case12_tracked_comments),
    ("13-reorder-and-repeats", case13_reorder),
    ("14-unicode-and-normalisation", case14_unicode),
    ("15-realistic-sop", case15_sop),
]
