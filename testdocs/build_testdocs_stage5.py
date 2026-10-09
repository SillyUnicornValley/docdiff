#!/usr/bin/env python3
"""Stage 5 test pairs (16 and later) for docdiff: formatting check, old content
with footnotes / links / fields / pictures, other parts and comments.

Built with the primitives of build_testdocs.py; run that script to generate
them (`python3 build_testdocs.py --only=16,17,18`). Expected results are in README.md.
"""
from xml.sax.saxutils import quoteattr

from build_testdocs import (BOOKMARK, CMT, FIELD, FNREF, H1, H2, LI, P, R, REL, TBL, TITLE, Doc, _next, png)
from build_testdocs_advanced import EQ, ENREF, MATH, TEXTBOX, VML

# ---------------------------------------------------------------- primitives

SPACED = '<w:spacing w:before="0" w:after="360"/>'
INDENTED = '<w:ind w:left="720"/>'

STRONG_STYLE = ('<w:style w:type="paragraph" w:customStyle="1" w:styleId="StrongNote"><w:name w:val="Strong Note"/>'
                '<w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>')
EMPHASIS_STYLE = ('<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/>'
                  '<w:rPr><w:i/></w:rPr></w:style>')
LIST_TABLE = ('<w:style w:type="table" w:styleId="LightList"><w:name w:val="Light List"/><w:basedOn w:val="TableNormal"/>'
              '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
              '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr></w:style>')


def HL(text, color="yellow"):
    """A highlighted run."""
    return f'<w:r><w:rPr><w:highlight w:val="{color}"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'


def with_table_style(tbl_xml, style):
    return tbl_xml.replace('<w:tblStyle w:val="TableGrid"/>', f'<w:tblStyle w:val="{style}"/>', 1)


def footnote_with_link(doc, text, url, link_text):
    """A footnote whose text holds a hyperlink (a relationship of the footnotes part)."""
    fid = len(doc.footnotes) + 1
    rid = f"rIdFnLink{fid}"
    doc.fn_rels.append(f'<Relationship Id="{rid}" Type="{REL}/hyperlink" Target={quoteattr(url)} TargetMode="External"/>')
    doc.footnotes.append(
        f'<w:footnote w:id="{fid}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
        f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>{R(" " + text + " ")}'
        f'<w:hyperlink r:id="{rid}">{R(link_text, rstyle="Hyperlink")}</w:hyperlink></w:p></w:footnote>')
    return fid


def linked_image(doc, url):
    """A picture linked to an outside file (not embedded): cannot be brought back."""
    rid = f"rIdLinked{len(doc.rels) + 1}"
    doc.rels.append(f'<Relationship Id="{rid}" Type="{REL}/image" Target={quoteattr(url)} TargetMode="External"/>')
    did = _next("docpr")
    return (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="914400" cy="457200"/><wp:docPr id="{did}" name="Linked logo"/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
        '<pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:link="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>")


# ---------------------------------------------------------------- 16 formatting only

def case16_formatting():
    styles = STRONG_STYLE + EMPHASIS_STYLE + LIST_TABLE
    old = Doc(styles_extra=styles)
    new = Doc(styles_extra=styles)
    for d in (old, new):
        d.add(P(TITLE + " - Formatting", style="Title"), H1("Storage and Handling"))

    old.add(P("The study drug must be stored below 25 °C."))
    new.add(P(["The study drug ", R("must", b=True), " be stored below 25 °C."]))  # bold on one word
    old.add(P(["Report all serious adverse events within ", R("24 hours", color="C00000"), "."]))
    new.add(P("Report all serious adverse events within 24 hours."))  # colour removed
    old.add(P("Keep the carton closed until use."))
    new.add(P([R("Keep the carton closed until use.", font="Arial", size=24)]))  # font and size
    old.add(P("Do not freeze."))
    new.add(P("Do not freeze.", jc="center"))  # alignment
    old.add(P("Protect from light."))
    new.add(P("Protect from light.", tabs=SPACED + INDENTED))  # spacing and indentation

    for d in (old, new):
        d.add(H1("Equivalent Formatting"))
    # Bold from a paragraph style vs direct bold: style name differs, bold does not.
    old.add(P("Only trained staff may prepare the infusion.", style="StrongNote"))
    new.add(P([R("Only trained staff may prepare the infusion.", b=True)]))
    # Italic from a character style vs direct italic: no difference.
    old.add(P(["Read the ", R("pharmacy manual", rstyle="Emphasis"), " first."]))
    new.add(P(["Read the ", R("pharmacy manual", i=True), " first."]))
    # Highlight added on unchanged words, and a content change in the same paragraph.
    old.add(P("Visits occur every 4 weeks during treatment."))
    new.add(P([R("Visits", i=True), " occur every 6 weeks during ", HL("treatment"), "."]))

    for d in (old, new):
        d.add(H1("Lists and Tables"))
    items = ["Check the expiry date.", "Inspect the vial.", "Record the batch number."]
    old.add(*[LI(t, 2) for t in items])  # bullets
    new.add(*[LI(t, 1) for t in items])  # numbers
    rows = [["Parameter", "Limit"], ["Temperature", "2–8 °C"], ["Humidity", "Below 60 %"]]
    old.add(TBL(rows, [4000, 4000]))
    new.add(with_table_style(TBL(rows, [4000, 4000]), "LightList"))
    for d in (old, new):
        d.add(P("End of formatting examples."))
    return old, new


# ---------------------------------------------------------------- 17 notes, links, fields, pictures; other parts

def case17_notes_links():
    old = Doc(header="CX-201 Pharmacy Manual", ns_extra=f"{MATH} {VML}")
    new = Doc(header="CX-201 Pharmacy Manual - Version 2", ns_extra=f"{MATH} {VML}")
    old.core_extra = "<dc:subject>Pharmacy manual</dc:subject>"
    new.core_extra = "<dc:subject>Pharmacy manual (revised)</dc:subject>"
    for d in (old, new):
        d.add(P(TITLE + " - Notes and Links", style="Title"), H1(BOOKMARK("_RefPrep", R("Preparation"))))

    # Modified paragraph: the old one has a footnote, the new one does not.
    f1 = old.footnote("Use a 0.2 micron in-line filter.")
    old.add(P(["Dilute the concentrate in 250 mL of saline", FNREF(f1), " before use."]))
    new.add(P("Dilute the concentrate in 500 mL of saline before use."))
    # Modified paragraph: both have a footnote, its text changed.
    f2o = old.footnote("Infusion pumps must be calibrated yearly.")
    f2n = new.footnote("Infusion pumps must be calibrated every six months.")
    old.add(P(["Infuse over 60 minutes", FNREF(f2o), "."]))
    new.add(P(["Infuse over 90 minutes", FNREF(f2n), "."]))
    # Deleted paragraph with a hyperlink and a footnote whose text holds a link.
    f3 = footnote_with_link(old, "See the stability data at", "https://example.com/cx201/stability", "the sponsor portal")
    old.add(P(["Prepared solutions are stable for 24 hours", FNREF(f3), ". Details are on the ",
               old.hyperlink("https://example.com/cx201/handling", "handling page"), "."]))
    # Deleted paragraph with an embedded picture.
    old.add(P(old.image(png(48, 24, (40, 160, 90))), jc="center"))
    old.add(P("Figure 2. Infusion set-up.", style="Caption", jc="center"))
    # Deleted paragraph with an equation.
    old.add(P(["The dose is calculated as ", EQ("Dose = BSA × 75"), "."]))
    # Cross-reference to a bookmark that exists in both files (text changed).
    old.add(P(["Follow the steps in ", FIELD("REF _RefPrep \\h", R("Preparation")), " before each dose."]))
    new.add(P(["Follow all steps in ", FIELD("REF _RefPrep \\h", R("Preparation")), " before each dose."]))

    for d in (old, new):
        d.add(H1("Disposal"))
    # Cross-reference to a bookmark only in the old file: "Use old" stays unavailable.
    old.add(P(["Return used vials as described in ", FIELD("REF _RefReturns \\h", R("Returns")), "."]))
    old.add(H2(BOOKMARK("_RefReturns", R("Returns"))))
    old.add(P("Used vials go back to the pharmacy in the original carton."))
    new.add(P("Used vials are destroyed on site."))
    # Endnote: the new file has no endnotes part, so "Use old" stays unavailable.
    e1 = old.endnote("Local regulations may require a witness.")
    old.add(P(["Destruction is documented on the accountability log", ENREF(e1), "."]))
    new.add(P("Destruction is documented on the accountability log."))
    # Linked picture: cannot be brought back.
    old.add(P([linked_image(old, "file:///C:/Logos/sponsor.png")], jc="center"))
    # Hyperlink address changed, same display text; text box text changed.
    old.add(P(["Questions: see the ", old.hyperlink("https://example.com/faq-2025", "FAQ"), "."]))
    new.add(P(["Questions: see the ", new.hyperlink("https://example.com/faq-2026", "FAQ"), "."]))
    old.add(P(TEXTBOX("Keep out of reach of children.")))
    new.add(P(TEXTBOX("Keep out of the reach and sight of children.")))
    for d in (old, new):
        d.add(P("End of manual."))
    return old, new


# ---------------------------------------------------------------- 18 comments

def case18_comments():
    old = Doc()
    new = Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Comments", style="Title"), H1("Eligibility"))

    # Same comment, same anchor, in both files.
    for d in (old, new):
        c = d.comment("Confirm with the medical monitor.", "Dana", "D")
        d.add(P(["Participants must be ", CMT(c, R("18 years or older")), " at screening."]))
    # Comment text changed.
    co = old.comment("Is 30 days enough?", "Dana", "D")
    cn = new.comment("Is 30 days enough? Steering committee says yes.", "Dana", "D")
    old.add(P(["No investigational drug within ", CMT(co, R("30 days")), " before Day 1."]))
    new.add(P(["No investigational drug within ", CMT(cn, R("30 days")), " before Day 1."]))
    # Anchored text changed (the paragraph is a difference).
    co = old.comment("Check the lower limit.", "Evan", "E")
    cn = new.comment("Check the lower limit.", "Evan", "E")
    old.add(P(["Body weight of ", CMT(co, R("at least 45 kg")), " is required."]))
    new.add(P(["Body weight of ", CMT(cn, R("at least 50 kg")), " is required."]))
    # Only in the old file.
    co = old.comment("Remove this criterion?", "Evan", "E")
    for d, c in ((old, co), (new, None)):
        text = "Participants must be able to swallow tablets."
        d.add(P(CMT(c, R(text)) if c is not None else text))
    # Only in the new file, on an added paragraph.
    cn = new.comment("Added after the safety review.", "Farah", "F")
    new.add(P(CMT(cn, R("Participants with a history of seizures are excluded."))))
    for d in (old, new):
        d.add(P("All criteria are checked again on Day 1."))
    return old, new


STAGE5_CASES = [
    ("16-formatting", case16_formatting),
    ("17-notes-links-images", case17_notes_links),
    ("18-comments", case18_comments),
]
