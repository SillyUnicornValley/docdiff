#!/usr/bin/env python3
"""Generate paired old/new .docx test documents for docdiff.

Standard library only. Writes raw OOXML so that tracked changes, merged
cells, comments, footnotes, fields and section breaks are fully controlled.

Usage: python3 build_testdocs.py [output_dir] [--only=08,09]
Cases 08 and later live in build_testdocs_advanced.py.
"""
import os
import random
import struct
import sys
import zipfile
import zlib
from xml.sax.saxutils import escape, quoteattr

DATE = "2026-09-01T10:00:00Z"
NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
)
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
LETTER = '<w:pgSz w:w="12240" w:h="15840"/>'
LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
MARGINS = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'

# ---------------------------------------------------------------- primitives

_ids = {"rev": 1000, "bm": 100, "docpr": 1}


def _next(kind):
    _ids[kind] += 1
    return _ids[kind]


def _ra(author):
    return f'w:id="{_next("rev")}" w:author="{author}" w:date="{DATE}"'


def R(text, b=False, i=False, u=False, sup=False, sub=False, size=None,
      color=None, font=None, vanish=False, rstyle=None, deleted=False,
      rpr_change=None):
    """A run. rpr_change=author marks a tracked formatting change."""
    rpr = ""
    if rstyle:
        rpr += f'<w:rStyle w:val="{rstyle}"/>'
    if font:
        rpr += f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>'
    if b:
        rpr += "<w:b/>"
    if i:
        rpr += "<w:i/>"
    if vanish:
        rpr += "<w:vanish/>"
    if color:
        rpr += f'<w:color w:val="{color}"/>'
    if size:
        rpr += f'<w:sz w:val="{size}"/>'
    if u:
        rpr += '<w:u w:val="single"/>'
    if sup or sub:
        rpr += f'<w:vertAlign w:val="{"superscript" if sup else "subscript"}"/>'
    if rpr_change:
        rpr += f'<w:rPrChange {_ra(rpr_change)}><w:rPr/></w:rPrChange>'
    tag = "w:delText" if deleted else "w:t"
    rpr = f"<w:rPr>{rpr}</w:rPr>" if rpr else ""
    return f'<w:r>{rpr}<{tag} xml:space="preserve">{escape(text)}</{tag}></w:r>'


BR = "<w:r><w:br/></w:r>"
TAB = "<w:r><w:tab/></w:r>"


def runs(content):
    if content is None or content == "":
        return ""
    if isinstance(content, str):
        return content if content.startswith("<") else R(content)
    return "".join(runs(c) for c in content)


def P(content="", style=None, num=None, pbb=False, tabs=None, jc=None,
      mark=None, sect=None, ppr_change=None):
    """A paragraph. num=(numId, ilvl). mark=xml placed in the paragraph-mark rPr."""
    ppr = ""
    if style:
        ppr += f'<w:pStyle w:val="{style}"/>'
    if pbb:
        ppr += "<w:pageBreakBefore/>"
    if num:
        ppr += f'<w:numPr><w:ilvl w:val="{num[1]}"/><w:numId w:val="{num[0]}"/></w:numPr>'
    if tabs:
        ppr += tabs
    if jc:
        ppr += f'<w:jc w:val="{jc}"/>'
    if mark:
        ppr += f"<w:rPr>{mark}</w:rPr>"
    if sect:
        ppr += sect
    if ppr_change:
        ppr += ppr_change
    ppr = f"<w:pPr>{ppr}</w:pPr>" if ppr else ""
    return f"<w:p>{ppr}{runs(content)}</w:p>"


def H1(t, **kw):
    return P(t, style="Heading1", **kw)


def H2(t, **kw):
    return P(t, style="Heading2", **kw)


def H3(t, **kw):
    return P(t, style="Heading3", **kw)


def LI(t, num_id, lvl=0, **kw):
    return P(t, style="ListParagraph", num=(num_id, lvl), **kw)


# tracked changes
def INS(content, author):
    return f"<w:ins {_ra(author)}>{runs(content)}</w:ins>"


def DEL(text, author, **fmt):
    return f"<w:del {_ra(author)}>{R(text, deleted=True, **fmt)}</w:del>"


def MARK_INS(author):
    return f"<w:ins {_ra(author)}/>"


def MARK_DEL(author):
    return f"<w:del {_ra(author)}/>"


def PPR_CHANGE(author, old_style):
    return f'<w:pPrChange {_ra(author)}><w:pPr><w:pStyle w:val="{old_style}"/></w:pPr></w:pPrChange>'


# tables
def TC(content, w, span=1, vmerge=None, shade=None, extra=""):
    tcpr = f'<w:tcW w:w="{w}" w:type="dxa"/>'
    if span > 1:
        tcpr += f'<w:gridSpan w:val="{span}"/>'
    if vmerge == "restart":
        tcpr += '<w:vMerge w:val="restart"/>'
    elif vmerge:
        tcpr += "<w:vMerge/>"
    if shade:
        tcpr += f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>'
    tcpr += extra  # e.g. a tracked cell insertion (must come last in tcPr)
    if content is None:
        body = "<w:p/>"
    elif isinstance(content, str):
        body = P(content)
    else:
        body = "".join(content)
        if not body.rstrip().endswith("</w:p>"):
            body += "<w:p/>"  # a cell must end with a paragraph
    return f"<w:tc><w:tcPr>{tcpr}</w:tcPr>{body}</w:tc>"


def TBL(rows, widths, header=True):
    """rows: list of rows; a row is a list of cells or {'cells': [...], 'trpr': xml}.
    A cell is str | None | list of block xml | {'c': ..., 'span', 'vmerge', 'shade'}."""
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    out = [
        f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="{sum(widths)}" w:type="dxa"/>'
        '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
        f"</w:tblPr><w:tblGrid>{grid}</w:tblGrid>"
    ]
    for ri, row in enumerate(rows):
        trpr, cells = ("", row) if isinstance(row, list) else (row.get("trpr", ""), row["cells"])
        if header and ri == 0:
            trpr = "<w:tblHeader/>" + trpr
        col, tcs = 0, ""
        for c in cells:
            if isinstance(c, dict):
                span = c.get("span", 1)
                tcs += TC(c.get("c"), sum(widths[col:col + span]), span, c.get("vmerge"), c.get("shade"), c.get("extra", ""))
            else:
                span = 1
                if header and ri == 0 and isinstance(c, str):
                    c = [P([R(c, b=True)])]
                tcs += TC(c, widths[col], shade="D9E2F3" if header and ri == 0 else None)
            col += span
        out.append(f'<w:tr>{"<w:trPr>" + trpr + "</w:trPr>" if trpr else ""}{tcs}</w:tr>')
    out.append("</w:tbl>")
    return "".join(out)


# fields, bookmarks, notes, comments
def FIELD(instr, result_runs):
    return (
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        f'<w:r><w:instrText xml:space="preserve"> {escape(instr)} </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        f'{runs(result_runs)}<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    )


def FLD_SIMPLE(instr, result):
    return f"<w:fldSimple w:instr={quoteattr(' ' + instr + ' ')}>{R(result)}</w:fldSimple>"


def BOOKMARK(name, content):
    bid = _next("bm")
    return f'<w:bookmarkStart w:id="{bid}" w:name="{name}"/>{runs(content)}<w:bookmarkEnd w:id="{bid}"/>'


def FNREF(fid):
    return f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="{fid}"/></w:r>'


def CMT(cid, content):
    return (
        f'<w:commentRangeStart w:id="{cid}"/>{runs(content)}<w:commentRangeEnd w:id="{cid}"/>'
        f'<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{cid}"/></w:r>'
    )


def IMG(rid, name, cx=1828800, cy=914400):
    did = _next("docpr")
    return (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{did}" name="Picture {did}"/>'
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
        f'<pic:nvPicPr><pic:cNvPr id="0" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    )


def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


# ---------------------------------------------------------------- package parts

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:color w:val="2F5496"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="44546A"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>"""


def _lvl(ilvl, fmt, text, left, pstyle=None, font=None):
    ps = f'<w:pStyle w:val="{pstyle}"/>' if pstyle else ""
    rpr = f'<w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:hint="default"/></w:rPr>' if font else ""
    return (f'<w:lvl w:ilvl="{ilvl}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/>{ps}'
            f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
            f'<w:pPr><w:ind w:left="{left}" w:hanging="360"/></w:pPr>{rpr}</w:lvl>')


NUMBERING = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering {NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>{_lvl(0, "decimal", "%1.", 720)}{_lvl(1, "lowerLetter", "%2.", 1440)}{_lvl(2, "lowerRoman", "%3.", 2160)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>{_lvl(0, "bullet", "•", 720, font="Symbol")}{_lvl(1, "bullet", "o", 1440, font="Courier New")}</w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>{_lvl(0, "decimal", "%1", 432, pstyle="Heading1")}{_lvl(1, "decimal", "%1.%2", 576, pstyle="Heading2")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
<w:num w:numId="5"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
</w:numbering>"""


class Doc:
    def __init__(self, header=None, ns_extra="", styles_extra="", style_ids=None, num_extra_abstract="",
                 num_extra_num="", even_odd=False):
        """ns_extra: more namespace declarations on the document root (w14, m, v…).
        styles_extra: more w:style elements. style_ids: {"Heading1": "Ueberschrift1"} renames
        style ids everywhere (like a localized Word). num_extra_*: more list definitions."""
        self.body = []
        self.comments = []
        self.footnotes = []
        self.endnotes = []
        self.rels = []
        self.media = {}
        self.header = header
        self.final_page = LETTER
        self.final_sect = None  # full w:sectPr xml for the last section (overrides header/final_page)
        self.hf = []  # (kind, rid, file name, xml content)
        self.ns_extra = ns_extra
        self.styles_extra = styles_extra
        self.style_ids = style_ids or {}
        self.num_extra_abstract = num_extra_abstract
        self.num_extra_num = num_extra_num
        self.even_odd = even_odd
        self.fn_rels = []  # relationships of the footnotes part (links inside footnotes)
        self.core_extra = ""  # more document properties (dc:subject…)

    def add_hf(self, kind, content):
        """A header or footer part. content: text or paragraph xml. Returns its relationship id."""
        n = len(self.hf) + 1
        rid = f"rIdHF{n}"
        body = content if content.startswith("<") else P(content, style="Header")
        self.hf.append((kind, rid, f"{kind}{n}.xml", body))
        return rid

    def sect(self, page=LETTER, hdr=None, ftr=None, title_pg=False, sect_type=None, cols=None):
        """A w:sectPr. hdr/ftr: {"default"|"first"|"even": rid}."""
        refs = "".join(f'<w:headerReference w:type="{t}" r:id="{rid}"/>' for t, rid in (hdr or {}).items())
        refs += "".join(f'<w:footerReference w:type="{t}" r:id="{rid}"/>' for t, rid in (ftr or {}).items())
        typ = f'<w:type w:val="{sect_type}"/>' if sect_type else ""
        col = f'<w:cols w:num="{cols}" w:space="720"/>' if cols else '<w:cols w:space="720"/>'
        return f"<w:sectPr>{refs}{typ}{page}{MARGINS}{col}{'<w:titlePg/>' if title_pg else ''}</w:sectPr>"

    def endnote(self, text):
        eid = len(self.endnotes) + 1
        self.endnotes.append(
            f'<w:endnote w:id="{eid}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:endnoteRef/></w:r>'
            f'{R(" " + text)}</w:p></w:endnote>')
        return eid

    def add(self, *xml):
        self.body.extend(xml)

    def comment(self, text, author="Reviewer B", initials="RB"):
        cid = len(self.comments)
        self.comments.append(
            f'<w:comment w:id="{cid}" w:author="{author}" w:date="{DATE}" w:initials="{initials}">'
            f'<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>{R(text)}</w:p></w:comment>')
        return cid

    def footnote(self, text):
        fid = len(self.footnotes) + 1
        self.footnotes.append(
            f'<w:footnote w:id="{fid}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
            f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>{R(" " + text)}</w:p></w:footnote>')
        return fid

    def hyperlink(self, url, text):
        rid = f"rIdLink{len(self.rels) + 1}"
        self.rels.append(f'<Relationship Id="{rid}" Type="{REL}/hyperlink" Target={quoteattr(url)} TargetMode="External"/>')
        return f'<w:hyperlink r:id="{rid}">{R(text, rstyle="Hyperlink")}</w:hyperlink>'

    def image(self, data):
        n = len(self.media) + 1
        name = f"image{n}.png"
        self.media[name] = data
        rid = f"rIdImg{n}"
        self.rels.append(f'<Relationship Id="{rid}" Type="{REL}/image" Target="media/{name}"/>')
        return IMG(rid, name)

    def save(self, path):
        hdr_ref = '<w:headerReference w:type="default" r:id="rIdHdr"/>' if self.header else ""
        sect = self.final_sect or f"<w:sectPr>{hdr_ref}{self.final_page}{MARGINS}<w:cols w:space=\"720\"/></w:sectPr>"
        ns = f"{NS} {self.ns_extra}" if self.ns_extra else NS
        document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {ns}><w:body>'
                    + "".join(self.body) + sect + "</w:body></w:document>")
        rels = [f'<Relationship Id="rIdStyles" Type="{REL}/styles" Target="styles.xml"/>',
                f'<Relationship Id="rIdNum" Type="{REL}/numbering" Target="numbering.xml"/>',
                f'<Relationship Id="rIdSettings" Type="{REL}/settings" Target="settings.xml"/>'] + self.rels
        overrides = [("/word/document.xml", "wordprocessingml.document.main"),
                     ("/word/styles.xml", "wordprocessingml.styles"),
                     ("/word/numbering.xml", "wordprocessingml.numbering"),
                     ("/word/settings.xml", "wordprocessingml.settings"),
                     ("/docProps/core.xml", None)]
        styles = STYLES.replace("</w:styles>", self.styles_extra + "</w:styles>")
        numbering = NUMBERING.replace('<w:num w:numId="1">', self.num_extra_abstract + '<w:num w:numId="1">')
        numbering = numbering.replace("</w:numbering>", self.num_extra_num + "</w:numbering>")
        files = {"word/styles.xml": styles, "word/numbering.xml": numbering}
        if self.comments:
            rels.append(f'<Relationship Id="rIdComments" Type="{REL}/comments" Target="comments.xml"/>')
            overrides.append(("/word/comments.xml", "wordprocessingml.comments"))
            files["word/comments.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments {NS}>'
                                          + "".join(self.comments) + "</w:comments>")
        fn_pr = ""
        if self.footnotes:
            rels.append(f'<Relationship Id="rIdFootnotes" Type="{REL}/footnotes" Target="footnotes.xml"/>')
            overrides.append(("/word/footnotes.xml", "wordprocessingml.footnotes"))
            files["word/footnotes.xml"] = (
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes {NS}>'
                '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
                '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
                + "".join(self.footnotes) + "</w:footnotes>")
            fn_pr = '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>'
            if self.fn_rels:
                files["word/_rels/footnotes.xml.rels"] = (
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + "".join(self.fn_rels) + "</Relationships>")
        en_pr = ""
        if self.endnotes:
            rels.append(f'<Relationship Id="rIdEndnotes" Type="{REL}/endnotes" Target="endnotes.xml"/>')
            overrides.append(("/word/endnotes.xml", "wordprocessingml.endnotes"))
            files["word/endnotes.xml"] = (
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:endnotes {NS}>'
                '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>'
                '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>'
                + "".join(self.endnotes) + "</w:endnotes>")
            en_pr = '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>'
        for kind, rid, name, body in self.hf:
            rels.append(f'<Relationship Id="{rid}" Type="{REL}/{kind}" Target="{name}"/>')
            overrides.append((f"/word/{name}", f"wordprocessingml.{kind}"))
            tag = "w:hdr" if kind == "header" else "w:ftr"
            files[f"word/{name}"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<{tag} {NS}>{body}</{tag}>'
        if self.header:
            rels.append(f'<Relationship Id="rIdHdr" Type="{REL}/header" Target="header1.xml"/>')
            overrides.append(("/word/header1.xml", "wordprocessingml.header"))
            files["word/header1.xml"] = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr {NS}>'
                                         + P(self.header, style="Header", jc="right") + "</w:hdr>")
        files["word/settings.xml"] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings {NS}>'
            f'<w:defaultTabStop w:val="720"/>{"<w:evenAndOddHeaders/>" if self.even_odd else ""}{fn_pr}{en_pr}<w:compat><w:compatSetting w:name="compatibilityMode" '
            'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>')
        files["word/document.xml"] = document
        for a, b in self.style_ids.items():  # localized style ids: rename everywhere
            for k in list(files):
                if k.endswith(".xml"):
                    files[k] = files[k].replace(f'w:styleId="{a}"', f'w:styleId="{b}"').replace(f'w:val="{a}"', f'w:val="{b}"')
        files["word/_rels/document.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(rels) + "</Relationships>")
        files["_rels/.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            "</Relationships>")
        files["docProps/core.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{escape(os.path.basename(path))}</dc:title>{self.core_extra}<dc:creator>docdiff test generator</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{DATE}</dcterms:created></cp:coreProperties>')
        ct = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
              '<Default Extension="xml" ContentType="application/xml"/>',
              '<Default Extension="png" ContentType="image/png"/>']
        for part, kind in overrides:
            full = ("application/vnd.openxmlformats-package.core-properties+xml" if kind is None
                    else f"application/vnd.openxmlformats-officedocument.{kind}+xml")
            ct.append(f'<Override PartName="{part}" ContentType="{full}"/>')
        files["[Content_Types].xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + "".join(ct) + "</Types>")
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", files.pop("[Content_Types].xml"))
            for name, data in files.items():
                z.writestr(name, data)
            for name, data in self.media.items():
                z.writestr(f"word/media/{name}", data)


# ---------------------------------------------------------------- cases

TITLE = "Clinical Study Protocol CX-201"


def case01_basic_text():
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE, style="Title"), H1("Introduction"),
              P("This document describes the design of a randomized, double-blind study of Compound X "
                "in adults with moderate hypertension."))
    old.add(P("Participants will be treated for 12 weeks, followed by a 4-week safety follow-up period."))
    new.add(P("Participants will be treated for 24 weeks, followed by a 4-week safety follow-up period."))
    old.add(P("The primary objective is to evaluate the change in systolic blood pressure from baseline."))
    new.add(P("The primary objective is to assess the change in mean seated systolic blood pressure "
              "from baseline to Week 24."))
    old.add(H1("Study Design"))
    new.add(H1("Study Design and Duration"))
    for d in (old, new):
        d.add(P("Eligible participants will be randomized in a 1:1 ratio to Compound X or placebo."))
    new.add(P("Randomization will be stratified by site and baseline blood pressure category."))
    old.add(P("Visits will occur at screening, baseline, and Weeks 2, 4, 8 and 12."))
    new.add(P("Visits will occur at screening, baseline, and Weeks 2, 4, 8, 12, 16 and 24."))
    old.add(P("An interim analysis is not planned for this study."))
    for d in (old, new):
        d.add(P("The sponsor will provide study drug in identical blister packs."))
    # formatting-only change
    old.add(P("All adverse events must be reported within 24 hours of awareness."))
    new.add(P(["All adverse events must be reported within ", R("24 hours", b=True, color="C00000"),
               R(" of awareness.", font="Arial", size=24)]))
    # same text, different run fragmentation and invisible markup
    old.add(P("The investigator is responsible for maintaining accurate source documents."))
    new.add(P(['<w:r><w:t>The investi</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:t>gator</w:t></w:r>'
               '<w:proofErr w:type="spellEnd"/>',
               BOOKMARK("_Hlk1001", R(" is responsible for ")),
               '<w:r><w:lastRenderedPageBreak/><w:t>maintaining accurate</w:t></w:r>',
               R(" source documents.")]))
    # heading level change only
    old.add(H2("Safety Monitoring"))
    new.add(H3("Safety Monitoring"))
    for d in (old, new):
        d.add(P("A Data Monitoring Committee will review unblinded safety data every six months."))
    # page break before (pagination only)
    old.add(H1("Ethics"))
    new.add(H1("Ethics", pbb=True))
    for d in (old, new):
        d.add(P("The protocol will be approved by an independent ethics committee before enrollment begins."),
              P("This protocol will be conducted in accordance with Good Clinical Practice."))
    return old, new


def case02_lists():
    old, new = Doc(), Doc()
    HN = 4  # auto-numbered headings
    for d in (old, new):
        d.add(P(TITLE + " - Eligibility", style="Title"), H1("Inclusion Criteria", num=(HN, 0)))
    old.add(LI("Age 18 to 75 years at screening.", 1),
            LI("Seated systolic blood pressure between 140 and 179 mmHg.", 1),
            LI("Able to provide written informed consent.", 1),
            LI("Body mass index below 40 kg/m2.", 1))
    new.add(LI("Age 18 to 75 years at screening.", 1),
            LI("Diagnosis of essential hypertension for at least 3 months.", 1),
            LI("Seated systolic blood pressure between 140 and 179 mmHg.", 1),
            LI("Able to provide written informed consent.", 1),
            LI("Body mass index below 35 kg/m2.", 1))
    for d in (old, new):
        d.add(H1("Exclusion Criteria", num=(HN, 0)))
    old.add(LI("History of stroke or myocardial infarction within 6 months.", 3),
            LI("Pregnant or breastfeeding women.", 3),
            LI("Women of childbearing potential must use effective contraception.", 3, 1),
            LI("Participation in another interventional study within 30 days.", 3),
            LI("Known hypersensitivity to Compound X.", 3))
    new.add(LI("Known hypersensitivity to Compound X.", 3),
            LI("Pregnant or breastfeeding women.", 3),
            LI("Women of childbearing potential must use highly effective contraception.", 3, 1),
            LI("Participation in another interventional study within 30 days.", 3))
    for d in (old, new):
        d.add(H1("Prohibited Medications", num=(HN, 0)))
    meds = ["Other antihypertensive agents", "Systemic corticosteroids", "Strong CYP3A4 inhibitors"]
    old.add(*[LI(m, 2) for m in meds])
    new.add(*[LI(m, 5) for m in meds + ["St. John's Wort"]])  # bullet -> numbered, plus one item
    new.add(H1("Concomitant Medications", num=(HN, 0)),
            P("Stable doses of lipid-lowering therapy are permitted."))
    for d in (old, new):
        d.add(H1("Study Procedures", num=(HN, 0)))
    steps = ["Obtain informed consent.", "Record vital signs.", "Collect blood samples."]
    old.add(*[P(f"{n}) {s}") for n, s in enumerate(steps, 1)])  # typed numbers
    new.add(*[LI(s, 1) for s in steps])  # auto numbering (continues list 1 on purpose)
    return old, new


def case03_tables():
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Tables", style="Title"), H1("Dose Cohorts"),
              P("Table 1 lists the planned dose cohorts."))
    hdr = ["Cohort", "Dose", "Participants"]
    old.add(TBL([hdr, ["1", "10 mg", "12"], ["2", "20 mg", "12"], ["3", "40 mg", "12"], ["4", "80 mg", "12"]],
                [2000, 3000, 3000]))
    new.add(TBL([hdr, ["1", "10 mg", "12"], ["1b", "15 mg", "6"], ["2", "20 mg", "18"], ["4", "80 mg", "12"],
                 ["5", "160 mg", "6"]], [2000, 3000, 3000]))

    for d in (old, new):
        d.add(P("Dose escalation will proceed after review of safety data from each cohort."),
              H1("Schedule of Assessments"))
    old.add(TBL([["Assessment", "Screening", "Baseline", "Week 12"],
                 ["Informed consent", "X", "", ""],
                 ["Vital signs", "X", "X", "X"],
                 ["ECG", "X", "", "X"],
                 ["Laboratory tests", "X", "X", "X"]], [3200, 1600, 1600, 1600]))
    new.add(TBL([["Assessment", "Screening", "Baseline", "Week 4", "Week 24"],
                 ["Informed consent", "X", "", "", ""],
                 ["Vital signs", "X", "X", "X", "X"],
                 ["ECG", "X", "", "", ""],
                 ["Laboratory tests", "X", "X", "X", "X"]], [3200, 1300, 1300, 1300, 1300]))

    for d in (old, new):
        d.add(H1("Laboratory Panels"))
    M = lambda t: {"c": t, "vmerge": "restart"}
    C = {"c": None, "vmerge": "cont"}
    old.add(TBL([["Panel", "Test", "Units"],
                 [M("Hematology"), "Hemoglobin", "g/dL"],
                 [C, "Platelets", "10^9/L"],
                 [C, "White blood cells", "10^9/L"],
                 [M("Chemistry"), "ALT", "U/L"],
                 [C, "Creatinine", "mg/dL"]], [2600, 3400, 2600]))
    new.add(TBL([["Panel", "Test", "Units"],
                 [M("Hematology"), "Hemoglobin", "g/dL"],
                 [C, "Platelets", "10^9/L"],
                 [C, "White blood cells", "10^9/L"],
                 [C, "Neutrophils", "10^9/L"],
                 [M("Chemistry"), "ALT", "U/L"],
                 [C, "Creatinine", "umol/L"],
                 [{"c": "Note: all samples will be analyzed by the central laboratory.", "span": 3}]],
                [2600, 3400, 2600]))

    for d in (old, new):
        d.add(H1("Study Contacts"))
    old.add(P("Sponsor: Acme Pharma Ltd."), P("CRO: Beta Research Inc."))
    new.add(TBL([["Role", "Organization"], ["Sponsor", "Acme Pharma Ltd."], ["CRO", "Beta Research Inc."]],
                [3000, 5000]))

    for d in (old, new):
        d.add(H1("Abbreviations"))
    old.add(TBL([["Abbreviation", "Definition"], ["AE", "Adverse event"], ["ECG", "Electrocardiogram"]],
                [3000, 5000]))
    new.add(P("Abbreviations are defined at first use in the text."))

    for d in (old, new):
        d.add(H1("Nested Table"))
    inner_old = TBL([["Visit", "Window"], ["Week 4", "+/- 3 days"]], [1800, 1800])
    inner_new = TBL([["Visit", "Window"], ["Week 4", "+/- 5 days"]], [1800, 1800])
    for d, inner in ((old, inner_old), (new, inner_new)):
        d.add(TBL([["Item", "Details"], ["Visit windows", [P("Windows are relative to baseline:"), inner]]],
                  [3000, 5000]))
        d.add(P("End of tables."))
    return old, new


def case04_tracked_changes():
    A, B = "Alice (old reviewer)", "Bob (new reviewer)"
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Existing Revisions", style="Title"), H1("Enrollment"))
    # P1: insert/delete inside a paragraph
    old.add(P(["The study will enroll ", DEL("100", A), INS("120", A), " participants across ",
               INS("15 ", A), "sites."]))
    new.add(P(["The study will enroll ", DEL("120", B), INS("150", B), " participants across 15 sites."]))
    # P2: whole paragraph deleted (tracked) in old only
    old.add(P([DEL("This paragraph was deleted by a tracked change in the old version.", A)], mark=MARK_DEL(A)))
    # P3: whole paragraph inserted (tracked) in old; plain in new
    old.add(P([INS("This paragraph was inserted by a tracked change in the old version.", A)], mark=MARK_INS(A)))
    new.add(P("This paragraph was inserted by a tracked change in the old version."))
    # P4: formatting revision in old, text insertion in new
    old.add(P(["Dosing will be ", R("once daily", b=True, rpr_change=A), "."]))
    new.add(P(["Dosing will be once daily", INS(" with food", B), "."]))
    # P5: paragraph-mark deletion -> merge in new
    for d in (old, new):
        d.add(H1("Washout"))
    old.add(P("The washout period is 2 weeks."), P("Participants must discontinue prior therapy."))
    new.add(P("The washout period is 2 weeks. ", mark=MARK_DEL(B)),
            P("Participants must discontinue prior therapy."))
    # P6: tracked move in new
    for d in (old, new):
        d.add(H1("Blinding"))
    moved = "Unblinding procedures are described in Section 9."
    old.add(P(moved), P("Study drug and placebo will be identical in appearance."),
            P("Emergency unblinding is available through the IRT system."))
    mid = _next("rev")
    new.add(P(f'<w:moveFromRangeStart w:id="{mid}" w:author="{B}" w:date="{DATE}" w:name="move1"/>'
              f'<w:moveFrom {_ra(B)}>{R(moved)}</w:moveFrom><w:moveFromRangeEnd w:id="{mid}"/>',
              mark=f'<w:moveFrom {_ra(B)}/>'),
            P("Study drug and placebo will be identical in appearance."),
            P("Emergency unblinding is available through the IRT system."))
    mid2 = _next("rev")
    new.add(P(f'<w:moveToRangeStart w:id="{mid2}" w:author="{B}" w:date="{DATE}" w:name="move1"/>'
              f'<w:moveTo {_ra(B)}>{R(moved)}</w:moveTo><w:moveToRangeEnd w:id="{mid2}"/>',
              mark=f'<w:moveTo {_ra(B)}/>'))
    # P7: tracked style change Normal -> Heading2
    old.add(P("Statistical Considerations"))
    new.add(P("Statistical Considerations", style="Heading2", ppr_change=PPR_CHANGE(B, "Normal")))
    for d in (old, new):
        d.add(P("The sample size provides 90% power at a two-sided alpha of 0.05."))
    # P8: tracked table row insert and delete in new
    old.add(TBL([["Visit", "Day"], ["Screening", "-28 to -1"], ["Baseline", "1"], ["Week 12", "84"]], [4000, 4000]))
    new.add(TBL([["Visit", "Day"],
                 ["Screening", "-28 to -1"],
                 {"cells": [[P([INS("Run-in", B)], mark=MARK_INS(B))], [P([INS("-7", B)], mark=MARK_INS(B))]],
                  "trpr": MARK_INS(B)},
                 ["Baseline", "1"],
                 {"cells": [[P([DEL("Week 12", B)], mark=MARK_DEL(B))], [P([DEL("84", B)], mark=MARK_DEL(B))]],
                  "trpr": MARK_DEL(B)}], [4000, 4000]))
    # P9: two authors in one paragraph
    old.add(P("Samples will be stored at -80 C for up to 5 years."))
    new.add(P(["Samples will be stored at ", DEL("-80 C", A), INS("-70 C", A), " for up to ",
               DEL("5", B), INS("10", B), " years."]))
    return old, new


def case05_uncompared_and_comments():
    old = Doc(header="Protocol CX-201 - Confidential")
    new = Doc(header="Protocol CX-201 v2.0 - Confidential")
    tabs = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs>'

    def toc(entries):
        out = []
        for n, (text, page) in enumerate(entries):
            content = [R(text), TAB, R(str(page))]
            if n == 0:
                content = [FIELD('TOC \\o "1-3" \\h \\z \\u', "")[:-len('<w:r><w:fldChar w:fldCharType="end"/></w:r>')]] + content
            out.append(P(content, style="TOC1", tabs=tabs))
        out.append(P('<w:r><w:fldChar w:fldCharType="end"/></w:r>'))
        return out

    old.add(P(TITLE + " - Other Elements", style="Title"), P(["Version date: ", FLD_SIMPLE('DATE \\@ "yyyy-MM-dd"', "2026-03-01")]),
            *toc([("Treatment", 1), ("Measurements", 1), ("Safety Reporting", 2)]))
    new.add(P(TITLE + " - Other Elements", style="Title"), P(["Version date: ", FLD_SIMPLE('DATE \\@ "yyyy-MM-dd"', "2026-09-15")]),
            *toc([("Treatment", 1), ("Measurements", 1), ("Safety Reporting Requirements", 2), ("Appendix A. Detailed Schedule", 3)]))

    for d in (old, new):
        d.add(H1("Treatment"))
    oc = old.comment("Old-version comment: confirm duration with the steering committee.", "Carol", "C")
    old.add(P(["Treatment duration is ", CMT(oc, R("12 weeks")), "."]))
    c1 = new.comment("Comment on changed text: 24 weeks agreed at the September meeting.")
    new.add(P(["Treatment duration is ", CMT(c1, R("24 weeks")), "."]))
    c2 = new.comment("Comment on unchanged text: please double-check the titration rule.")
    for d, extra in ((old, None), (new, c2)):
        text = "The dose may be titrated once after Week 2."
        d.add(P(CMT(extra, R(text)) if extra is not None else text))
    c3 = new.comment("Comment on a newly added paragraph.")
    new.add(P(CMT(c3, R("Missed doses should not be replaced."))))

    for d in (old, new):
        d.add(H1("Measurements"))
    f_old = old.footnote("Omron HEM-907 or equivalent.")
    f_new = new.footnote("Omron HEM-907XL or equivalent.")
    old.add(P(["Blood pressure will be measured using a validated device.", FNREF(f_old)]))
    new.add(P(["Blood pressure will be measured using a validated device.", FNREF(f_new)]))
    f2 = new.footnote("Readings are averaged over three measurements.")
    old.add(P("The mean of three seated readings will be used."))
    new.add(P(["The mean of three seated readings will be used.", FNREF(f2)]))
    old.add(P(["Full prescribing information is available on the ",
               old.hyperlink("https://example.com/compound-x/old-label", "sponsor website"), "."]))
    new.add(P(["Full prescribing information is available on the ",
               new.hyperlink("https://example.com/compound-x/label-2026", "sponsor website"), "."]))
    old.add(P(old.image(png(64, 32, (200, 60, 60))), jc="center"))
    new.add(P(new.image(png(64, 32, (60, 90, 200))), jc="center"))
    for d in (old, new):
        d.add(P("Figure 1. Study schema.", style="Caption", jc="center"))
    new.add(P(["Measurements are taken in the morning.",
               R(" INTERNAL NOTE: confirm timing with sponsor.", vanish=True)]))
    old.add(P("Measurements are taken in the morning."))

    old.add(H1(BOOKMARK("_Ref500", R("Safety Reporting"))))
    new.add(H1(BOOKMARK("_Ref500", R("Safety Reporting Requirements"))))
    old.add(P(["Serious adverse events are described in ", FIELD("REF _Ref500 \\h", R("Safety Reporting")), "."]))
    new.add(P(["Serious adverse events are described in ", FIELD("REF _Ref500 \\h", R("Safety Reporting Requirements")), "."]))
    for d in (old, new):
        d.add(P("Pregnancies must be reported within 24 hours."))

    # new: landscape appendix introduced by a section break carried on a new paragraph
    new.add(P("End of main protocol.",
              sect=f'<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/>{LETTER}{MARGINS}</w:sectPr>'),
            H1("Appendix A. Detailed Schedule"),
            P("This appendix is printed in landscape orientation."))
    new.final_page = LANDSCAPE
    return old, new


def case06_edge_alignment():
    old, new = Doc(), Doc()
    for d in (old, new):
        d.add(P(TITLE + " - Alignment Edge Cases", style="Title"), H1("Exploratory Assessments"))
    sections = ["Pharmacokinetics", "Pharmacogenomics", "Biomarkers", "Immunogenicity"]
    for s in sections:
        old.add(H2(s), P("Not applicable."))
        if s != "Pharmacogenomics":
            new.add(H2(s), P("Not applicable."))

    for d in (old, new):
        d.add(H1("Visits"))
    old.add(P("Protocol deviations will be documented in the trial master file."))
    old.add(P("Participants will attend a screening visit. Eligible participants will then be randomized "
              "at the baseline visit."))
    new.add(P("Participants will attend a screening visit."),
            P("Eligible participants will then be randomized at the baseline visit."))
    old.add(P("Blood samples will be collected after an overnight fast."),
            P("Samples will be processed within 2 hours."))
    new.add(P("Blood samples will be collected after an overnight fast and processed within 2 hours."))
    old.add(P(""), P(""))
    new.add(P(""))
    for d in (old, new):
        d.add(P("Unscheduled visits may be performed at the discretion of the investigator."))
    new.add(P(""), P(""))
    new.add(P("Protocol deviations will be documented in the trial master file."))

    for d in (old, new):
        d.add(H1("Typography"))
    old.add(P('Acme Pharma Ltd. (the "Sponsor") is responsible for the study.'))
    new.add(P("Acme Pharma Ltd. (the “Sponsor”) is responsible for the study."))
    old.add(P("This is a Phase II - III seamless design."))
    new.add(P("This is a Phase II–III seamless design."))
    old.add(P("See Section  5 for details."))
    new.add(P("See Section 5 for details."))
    old.add(P("The starting dose is 10 mg."))
    new.add(P("The starting dose is 10 mg."))
    old.add(P("Assessments occur at Week 12."))
    new.add(P("Assessments occur at week 12."))

    for d in (old, new):
        d.add(H1("Superscript and Line Breaks"))
    old.add(P(["Viral load above 10", R("6", sup=True), " copies/mL is exclusionary."]))
    new.add(P(["Viral load above 10", R("5", sup=True), " copies/mL is exclusionary."]))
    old.add(P(["Body mass index is reported in kg/m", R("2", sup=True), "."]))
    new.add(P("Body mass index is reported in kg/m2."))
    old.add(P("Contact: Dr. Jane Smith, Medical Monitor"))
    new.add(P(["Contact:", BR, "Dr. Jane Smith, Medical Monitor"]))

    for d in (old, new):
        d.add(H1("Rewrites"))
    old.add(P("Compliance will be assessed by pill count at each visit."))
    new.add(P("Adherence is calculated from returned blister packs and recorded in the eCRF by site staff."))
    long_old = (
        "The investigator must ensure that all study personnel are adequately trained on the protocol, "
        "the investigational product, and their study-related duties. The investigator will maintain a "
        "delegation log listing all individuals to whom study tasks have been delegated, together with "
        "their signatures and the dates of delegation. Training records must be filed in the investigator "
        "site file and made available for monitoring visits, audits, and regulatory inspections. Any new "
        "staff member joining the study team after site initiation must complete protocol training before "
        "performing any study-related activity, and this training must be documented within 5 working days."
    )
    old.add(P(long_old))
    new.add(P(long_old.replace("within 5 working days", "within 10 working days")))
    return old, new


def case07_long():
    rng = random.Random(20261007)
    words = ("participant investigator protocol visit dose safety efficacy endpoint analysis sample blood "
             "pressure treatment period baseline screening randomization placebo adverse event laboratory "
             "assessment schedule data monitoring committee sponsor site record report procedure criteria "
             "eligible measurement result interim primary secondary exploratory population consent device "
             "review medication follow-up withdrawal compliance storage shipment").split()

    def sentence():
        ws = [rng.choice(words) for _ in range(rng.randint(8, 18))]
        if rng.random() < 0.4:
            ws.insert(rng.randrange(len(ws)), str(rng.randint(2, 96)))
        return ws[0].capitalize() + " " + " ".join(ws[1:]) + "."

    blocks = []
    for ch in range(1, 61):
        blocks.append(["h1", f"Chapter {ch}. {rng.choice(words).capitalize()} {rng.choice(words)}"])
        for sec in range(1, 4):
            blocks.append(["h2", f"Section {ch}.{sec} {rng.choice(words).capitalize()}"])
            for _ in range(8):
                blocks.append(["p", " ".join(sentence() for _ in range(rng.randint(2, 5)))])
        blocks.append(["table", [["Parameter", "Value", "Unit", "Note"]] +
                       [[f"Parameter {ch}-{r}", str(rng.randint(1, 500)), rng.choice(["mg", "mL", "h", "%"]),
                         rng.choice(["", "fasting", "central lab", "local lab"])] for r in range(1, 8)]])

    new_blocks = [[k, (v if k != "table" else [row[:] for row in v])] for k, v in blocks]
    log = []

    def ctx(block):
        i = new_blocks.index(block)
        for k, v in reversed(new_blocks[:i]):
            if k == "h2":
                return v
        return "?"

    paras = lambda: [b for b in new_blocks if b[0] == "p"]
    for _ in range(40):
        b = rng.choice(paras())
        ws = b[1].split(" ")
        j = rng.randrange(len(ws))
        old_w = ws[j]
        ws[j] = str(rng.randint(100, 999)) if rng.random() < 0.5 else rng.choice(words)
        b[1] = " ".join(ws)
        log.append(f"MODIFY  [{ctx(b)}] word '{old_w}' -> '{ws[j]}'")
    for _ in range(10):
        b = rng.choice(paras())
        text = "NEW PARAGRAPH: " + sentence()
        new_blocks.insert(new_blocks.index(b) + 1, ["p", text])
        log.append(f"INSERT  [{ctx(b)}] after paragraph starting '{b[1][:40]}...'")
    for _ in range(10):
        b = rng.choice(paras())
        log.append(f"DELETE  [{ctx(b)}] paragraph starting '{b[1][:40]}...'")
        new_blocks.remove(b)
    for _ in range(2):
        b = rng.choice(paras())
        log.append(f"MOVE    [{ctx(b)}] paragraph starting '{b[1][:40]}...'")
        new_blocks.remove(b)
        target = rng.choice(paras())
        new_blocks.insert(new_blocks.index(target) + 1, b)
        log.append(f"        -> now after [{ctx(b)}]")
    tables = [b for b in new_blocks if b[0] == "table"]
    for _ in range(10):
        t = rng.choice(tables)
        r, c = rng.randint(1, 7), rng.randint(1, 3)
        old_v = t[1][r][c]
        t[1][r][c] = str(rng.randint(501, 999)) if c == 1 else "changed"
        log.append(f"CELL    [{t[1][1][0].split('-')[0]}] row {r} col {c}: '{old_v}' -> '{t[1][r][c]}'")
    for _ in range(3):
        t = rng.choice(tables)
        r = rng.randint(1, len(t[1]))
        t[1].insert(r, ["Inserted parameter", "1", "mg", "new row"])
        log.append(f"ROW+    [{t[1][1][0].split('-')[0]}] at position {r}")

    def render(bl):
        d = Doc()
        d.add(P(TITLE + " - Long Document", style="Title"))
        for k, v in bl:
            if k == "h1":
                d.add(H1(v))
            elif k == "h2":
                d.add(H2(v))
            elif k == "p":
                d.add(P(v))
            else:
                d.add(TBL(v, [2800, 1800, 1400, 2600]))
        return d

    return render(blocks), render(new_blocks), log


CASES = [
    ("01-basic-text", case01_basic_text),
    ("02-lists", case02_lists),
    ("03-tables", case03_tables),
    ("04-tracked-changes", case04_tracked_changes),
    ("05-uncompared-and-comments", case05_uncompared_and_comments),
    ("06-edge-alignment", case06_edge_alignment),
    ("07-long-document", case07_long),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--only=")]
    only = [a.split("=", 1)[1].split(",") for a in sys.argv[1:] if a.startswith("--only=")]
    out_dir = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")
    os.makedirs(out_dir, exist_ok=True)
    from build_testdocs_advanced import ADVANCED_CASES  # 08–15 (more complex documents)
    from build_testdocs_stage5 import STAGE5_CASES  # 16 and later (Stage 5: formatting, notes, comments)
    for name, fn in CASES + ADVANCED_CASES + STAGE5_CASES:
        if only and not any(name.startswith(o) for o in only[0]):
            continue
        result = fn()
        old, new = result[0], result[1]
        old.save(os.path.join(out_dir, f"{name}_old.docx"))
        new.save(os.path.join(out_dir, f"{name}_new.docx"))
        if len(result) > 2:
            with open(os.path.join(out_dir, f"{name}_changes.txt"), "w") as f:
                f.write("\n".join(result[2]) + "\n")
        print("wrote", name)


if __name__ == "__main__":
    main()
