from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from html import unescape
from pathlib import Path


SOURCE_HTML = Path("D:/tanyue/tmp/external/mao-quotes.html")
SOURCE_URL = "https://muninn.net/modules/mo3337/quotes/chinese/index.html"
OUTPUT_DIRECTORY = Path("D:/tanyue/output/imports/mao-quotations")
TARGET_CHARS = 150
MIN_CHARS = 90
MAX_CHARS = 220
EXPECTED_CHAPTERS = 33
EXPECTED_QUOTES = 427

INLINE_EDITOR_NOTE = re.compile(r"（[^（）]{0,300}?——(?:原)?编者）")
INLINE_REFERENCE = re.compile(r"(?:〔[0-9０-９]+〕|\[[0-9０-９]+\])")
SOURCE_PARAGRAPH = re.compile(
    r"(?:《[^》]+》.*[（(][一二三四五六七八九〇零]{4}年|"
    r"[（(][一二三四五六七八九〇零]{4}年.*(?:页|《人民日报》|出版社)|"
    r"人民日报出版社)"
)


@dataclass(frozen=True)
class Quote:
    quote_id: str
    chapter_title: str
    text: str


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: str) -> str:
    value = value.replace("\xa0", " ").replace("\u3000", " ").replace("\ufeff", "")
    paragraphs = []
    for paragraph in value.split("\n"):
        paragraph = re.sub(r"\s+", " ", paragraph).strip()
        paragraph = INLINE_EDITOR_NOTE.sub("", paragraph)
        paragraph = INLINE_REFERENCE.sub("", paragraph)
        paragraph = re.sub(r"\s+", " ", paragraph).strip()
        if paragraph and not SOURCE_PARAGRAPH.search(paragraph):
            paragraphs.append(paragraph)
    return "\n\n".join(paragraphs)


def parse_quotes() -> tuple[list[str], list[Quote]]:
    if not SOURCE_HTML.is_file():
        raise FileNotFoundError(f"找不到已下载的结构化原文：{SOURCE_HTML}")
    raw = SOURCE_HTML.read_text(encoding="utf-8")
    chapter_matches = re.findall(
        r'<h3 class="chapter-title"[^>]*>(.*?)</h3>', raw, flags=re.DOTALL
    )
    chapters = [normalize_text(re.sub(r"<[^>]+>", "", unescape(value))) for value in chapter_matches]
    chapter_by_number = {index + 1: title for index, title in enumerate(chapters)}
    quote_matches = re.findall(
        r'<p class="quote" id="([0-9]+\.[0-9]+)">(.*?)(?:</p>|(?=<h3 class="chapter-number"))',
        raw,
        flags=re.DOTALL,
    )
    quotes: list[Quote] = []
    for quote_id, body in quote_matches:
        chapter_number = int(quote_id.split(".", maxsplit=1)[0])
        if quote_id == "30.7":
            body = body.split("<br/>在接见", maxsplit=1)[0]
        body = re.sub(r"<(?:span|a|button|audio)\b[^>]*>.*?</(?:span|a|button|audio)>", "", body, flags=re.DOTALL)
        body = re.sub(r"<br\s*/?>", "\n", body, flags=re.IGNORECASE)
        body = re.sub(r"<[^>]+>", "", body)
        text = normalize_text(unescape(body))
        if not text or chapter_number not in chapter_by_number:
            raise AssertionError(f"语录 {quote_id} 缺少正文或章节。")
        quotes.append(Quote(quote_id, chapter_by_number[chapter_number], text))
    if len(chapters) != EXPECTED_CHAPTERS:
        raise AssertionError(f"应有 {EXPECTED_CHAPTERS} 章，实际为 {len(chapters)} 章。")
    if len(quotes) != EXPECTED_QUOTES:
        raise AssertionError(f"应有 {EXPECTED_QUOTES} 条语录，实际为 {len(quotes)} 条。")
    if len(set(chapters)) != EXPECTED_CHAPTERS:
        raise AssertionError("章节标题存在重复。")
    if len({quote.quote_id for quote in quotes}) != EXPECTED_QUOTES:
        raise AssertionError("语录编号存在重复。")
    return chapters, quotes


def choose_end(text: str, cursor: int) -> int:
    remaining = len(text) - cursor
    if remaining <= round(TARGET_CHARS * 1.35):
        return len(text)
    lower = min(len(text), cursor + MIN_CHARS)
    desired = min(len(text), cursor + TARGET_CHARS)
    upper = min(len(text), cursor + MAX_CHARS)
    for boundaries in (set("。！？!?；;"), set("，,:：、")):
        candidates = [index for index in range(lower, upper + 1) if text[index - 1] in boundaries]
        if candidates:
            return min(candidates, key=lambda index: (abs(index - desired), index < desired))
    return desired


def verify_coverage(blocks: list[dict[str, object]], segments: list[dict[str, object]]) -> None:
    cursors = {str(block["id"]): 0 for block in blocks}
    lengths = {str(block["id"]): len(str(block["text"])) for block in blocks}
    for segment in segments:
        for span in segment["spans"]:
            block_id = str(span["blockId"])
            if int(span["start"]) != cursors[block_id]:
                raise AssertionError(f"正文块 {block_id} 出现空洞、重复或乱序。")
            if int(span["end"]) > lengths[block_id]:
                raise AssertionError(f"正文块 {block_id} 的片段越界。")
            cursors[block_id] = int(span["end"])
    if not all(cursors[block_id] == lengths[block_id] for block_id in cursors):
        raise AssertionError("存在未被片段覆盖的正文块。")


def main() -> None:
    chapters, quotes = parse_quotes()
    blocks: list[dict[str, object]] = []
    segments: list[dict[str, object]] = []
    raw_html = SOURCE_HTML.read_text(encoding="utf-8")
    removed_inline_notes = len(INLINE_EDITOR_NOTE.findall(raw_html)) + len(INLINE_REFERENCE.findall(raw_html))

    for quote in quotes:
        chapter_number, quote_number = quote.quote_id.split(".", maxsplit=1)
        block_id = f"quote-{int(chapter_number):02d}-{int(quote_number):03d}"
        blocks.append(
            {
                "id": block_id,
                "sequence": len(blocks) + 1,
                "type": "paragraph",
                "text": quote.text,
                "sourceAnchor": {
                    "kind": "url",
                    "value": f"{SOURCE_URL}#{quote.quote_id}",
                    "label": f"{quote.chapter_title} · 第 {quote_number} 条",
                },
            }
        )
        cursor = 0
        while cursor < len(quote.text):
            end = choose_end(quote.text, cursor)
            segments.append(
                {
                    "chapterTitle": quote.chapter_title,
                    "spans": [{"blockId": block_id, "start": cursor, "end": end}],
                }
            )
            cursor = end

    for sequence, segment in enumerate(segments, start=1):
        segment["sequence"] = sequence
    verify_coverage(blocks, segments)

    source_hash = sha256(SOURCE_HTML)
    package = {
        "schemaVersion": 1,
        "offsetUnit": "unicode-scalar",
        "book": {"title": "毛主席语录（正文版）", "author": "毛泽东"},
        "source": {
            "name": SOURCE_URL,
            "format": "url",
            "mediaType": "text/html; charset=utf-8",
            "sha256": source_hash,
        },
        "processing": {
            "parser": {"id": "agent.html-structured-quote-body-only", "version": "1.0.0"},
            "segmenter": {
                "id": "agent.work-reading-boundary",
                "version": "1.0.0",
                "ruleVersion": "one-quotation-per-run-v1",
            },
        },
        "blocks": blocks,
        "segments": segments,
    }

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    package_path = OUTPUT_DIRECTORY / "毛主席语录-正文版.tanyue.json"
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
    segment_lengths = [span["end"] - span["start"] for segment in segments for span in segment["spans"]]
    report = {
        "sourceUrl": SOURCE_URL,
        "sourceSha256": source_hash,
        "chapterCount": len(chapters),
        "quotationCount": len(quotes),
        "blockCount": len(blocks),
        "segmentCount": len(segments),
        "unicodeScalarCount": sum(len(quote.text) for quote in quotes),
        "coveragePercent": 100,
        "removedInlineEditorOrReferenceMarks": removed_inline_notes,
        "segmentLength": {
            "minimum": min(segment_lengths),
            "maximum": max(segment_lengths),
            "average": round(sum(segment_lengths) / len(segment_lengths), 1),
        },
        "cleaningPolicy": {
            "removed": [
                "每条语录的编号、英文/音频控件",
                "每条语录后的作品名、日期、卷页等来源说明",
                "正文内以“——编者”结尾的编者插注和数字注号",
                "再版前言、网站说明和其他非语录内容",
            ],
            "preserved": "33 章共 427 条语录正文、原始章节归属与顺序；未进行 AI 改写。",
        },
        "output": str(package_path),
    }
    report_path = OUTPUT_DIRECTORY / "毛主席语录-正文版.import-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
