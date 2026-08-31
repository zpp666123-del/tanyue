from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


REPOSITORY = Path("D:/tanyue/tmp/external/MaoZeDongAnthology")
SOURCE_DIRECTORY = REPOSITORY / "src"
OUTPUT_DIRECTORY = Path("D:/tanyue/output/imports/mao-anthology-body-only")
TARGET_CHARS = 160
MIN_CHARS = 100
MAX_CHARS = 230

VOLUMES = (
    ("第一卷", "国内革命战争时期", 0, 17),
    ("第二卷", "抗日战争时期（上）", 18, 57),
    ("第三卷", "抗日战争时期（下）", 58, 88),
    ("第四卷", "第三次国内革命战争时期", 89, 158),
    ("第五卷", "中国人民站起来了", 159, 228),
)

NOTE_REFERENCE = re.compile(
    r"[\u2460-\u2473\u2474-\u2487]|〔[0-9０-９]+〕|\[[0-9０-９]+\]"
)
DATE_LINE = re.compile(r"^[（(].*(?:年|月|日).*[）)]$")
NOTE_HEADING = re.compile(r"^注\s*释$")
SEPARATOR = re.compile(r"^-{8,}$")
MARKDOWN_HEADING = re.compile(r"^#{1,6}\s+")
MARKDOWN_LIST = re.compile(r"^(?:[-*+]\s+|\d+[.)]\s+)")
MARKDOWN_LINK = re.compile(r"\[([^]]+)]\([^)]+\)")


@dataclass(frozen=True)
class CleanBlock:
    text: str
    line_start: int
    line_end: int


@dataclass(frozen=True)
class CleanArticle:
    number: int
    title: str
    filename: str
    raw_chars: int
    body_chars: int
    removed_note_chars: int
    removed_editor_chars: int
    removed_reference_count: int
    blocks: tuple[CleanBlock, ...]


def compact(value: str) -> str:
    return value.replace("\u3000", "").strip()


def repository_commit() -> str:
    return subprocess.check_output(
        ["git", "-C", str(REPOSITORY), "rev-parse", "HEAD"],
        text=True,
        encoding="utf-8",
    ).strip()


def ordered_sources() -> list[Path]:
    sources = sorted(
        path
        for path in SOURCE_DIRECTORY.glob("*.md")
        if re.match(r"^\d{3}-", path.name)
    )
    numbers = [int(path.name[:3]) for path in sources]
    assert numbers == list(range(229)), "仓库文章编号不是连续的 000～228。"
    return sources


def raw_source_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def note_start(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        if not SEPARATOR.fullmatch(compact(line)):
            continue
        for candidate in range(index + 1, min(index + 4, len(lines))):
            value = compact(lines[candidate])
            if not value:
                continue
            if NOTE_HEADING.fullmatch(value):
                return index
            break
    return None


def visible_markdown_text(line: str) -> str:
    value = line.strip()
    value = MARKDOWN_HEADING.sub("", value)
    value = MARKDOWN_LIST.sub("", value)
    value = value.removeprefix(">").strip()
    value = MARKDOWN_LINK.sub(r"\1", value)
    value = value.replace("**", "").replace("__", "")
    value = value.replace("`", "")
    return value.strip(" \t\u3000")


def clean_article(path: Path) -> CleanArticle:
    raw = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    lines = raw.split("\n")
    cutoff = note_start(lines)
    body_end = cutoff if cutoff is not None else len(lines)
    removed_note_chars = len("\n".join(lines[body_end:])) if cutoff is not None else 0

    cursor = next((index for index, line in enumerate(lines[:body_end]) if compact(line)), body_end)
    title = path.stem[4:]
    if cursor < body_end and MARKDOWN_HEADING.match(lines[cursor].strip()):
        parsed_title = visible_markdown_text(lines[cursor])
        if parsed_title:
            title = parsed_title
        cursor += 1

    while cursor < body_end and not compact(lines[cursor]):
        cursor += 1
    if cursor < body_end and DATE_LINE.fullmatch(compact(lines[cursor])):
        cursor += 1

    removed_editor_chars = 0
    while cursor < body_end:
        if not compact(lines[cursor]):
            cursor += 1
            continue
        if lines[cursor].lstrip().startswith(">"):
            removed_editor_chars += len(lines[cursor])
            cursor += 1
            continue
        break

    blocks: list[CleanBlock] = []
    removed_reference_count = 0
    for index in range(cursor, body_end):
        text = visible_markdown_text(lines[index])
        if not text:
            continue
        text, count = NOTE_REFERENCE.subn("", text)
        removed_reference_count += count
        text = text.strip(" \t\u3000")
        if text:
            blocks.append(CleanBlock(text=text, line_start=index + 1, line_end=index + 1))

    assert blocks, f"{path.name} 清洗后没有正文。"
    cleaned = "".join(block.text for block in blocks)
    assert "�" not in cleaned, f"{path.name} 含替代字符。"
    assert not NOTE_REFERENCE.search(cleaned), f"{path.name} 仍含注号。"
    assert not any(SEPARATOR.fullmatch(compact(block.text)) for block in blocks)
    assert not any(NOTE_HEADING.fullmatch(compact(block.text)) for block in blocks)
    return CleanArticle(
        number=int(path.name[:3]),
        title=title,
        filename=path.name,
        raw_chars=len(raw),
        body_chars=len(cleaned),
        removed_note_chars=removed_note_chars,
        removed_editor_chars=removed_editor_chars,
        removed_reference_count=removed_reference_count,
        blocks=tuple(blocks),
    )


def choose_end(text: str, cursor: int) -> int:
    remaining = len(text) - cursor
    if remaining <= round(TARGET_CHARS * 1.35):
        return len(text)
    lower = min(len(text), cursor + MIN_CHARS)
    desired = min(len(text), cursor + TARGET_CHARS)
    upper = min(len(text), cursor + MAX_CHARS)
    for boundaries in (set("。！？!?；;"), set("，,:：、\n")):
        candidates = [
            index
            for index in range(lower, upper + 1)
            if text[index - 1] in boundaries
        ]
        if candidates:
            return min(candidates, key=lambda index: (abs(index - desired), index < desired))
    return desired


def segment_article(
    package_blocks: list[dict[str, object]],
    article_block_ids: list[str],
    chapter_title: str,
) -> list[dict[str, object]]:
    block_by_id = {str(block["id"]): block for block in package_blocks}
    ranges: list[tuple[int, int, dict[str, object]]] = []
    combined = ""
    for block_id in article_block_ids:
        block = block_by_id[block_id]
        start = len(combined)
        combined += str(block["text"])
        ranges.append((start, len(combined), block))

    result: list[dict[str, object]] = []
    cursor = 0
    while cursor < len(combined):
        end = choose_end(combined, cursor)
        spans: list[dict[str, object]] = []
        for block_start, block_end, block in ranges:
            overlap_start = max(cursor, block_start)
            overlap_end = min(end, block_end)
            if overlap_start < overlap_end:
                spans.append(
                    {
                        "blockId": block["id"],
                        "start": overlap_start - block_start,
                        "end": overlap_end - block_start,
                    }
                )
        result.append({"chapterTitle": chapter_title, "spans": spans})
        cursor = end
    return result


def verify_coverage(
    blocks: list[dict[str, object]], segments: list[dict[str, object]]
) -> None:
    cursors = {str(block["id"]): 0 for block in blocks}
    lengths = {str(block["id"]): len(str(block["text"])) for block in blocks}
    for segment in segments:
        for span in segment["spans"]:
            block_id = str(span["blockId"])
            assert int(span["start"]) == cursors[block_id]
            assert int(span["end"]) <= lengths[block_id]
            cursors[block_id] = int(span["end"])
    assert all(cursors[block_id] == lengths[block_id] for block_id in cursors)


def create_volume(
    label: str,
    subtitle: str,
    articles: list[CleanArticle],
    commit: str,
    source_hash: str,
) -> dict[str, object]:
    blocks: list[dict[str, object]] = []
    segments: list[dict[str, object]] = []
    for article in articles:
        article_block_ids: list[str] = []
        for paragraph_number, clean_block in enumerate(article.blocks, start=1):
            block_id = f"md-{article.number:03d}-p-{paragraph_number:03d}"
            article_block_ids.append(block_id)
            blocks.append(
                {
                    "id": block_id,
                    "sequence": len(blocks) + 1,
                    "type": "paragraph",
                    "text": clean_block.text,
                    "sourceAnchor": {
                        "kind": "chapter",
                        "value": (
                            f"src/{article.filename}:"
                            f"{clean_block.line_start}-{clean_block.line_end}"
                        ),
                        "label": f"{article.title} · 原文件第 {clean_block.line_start} 行",
                    },
                }
            )
        segments.extend(segment_article(blocks, article_block_ids, article.title))

    for sequence, segment in enumerate(segments, start=1):
        segment["sequence"] = sequence
    verify_coverage(blocks, segments)

    title = f"毛泽东选集 {label}（正文版）"
    package = {
        "schemaVersion": 1,
        "offsetUnit": "unicode-scalar",
        "book": {"title": title, "author": "毛泽东"},
        "source": {
            "name": (
                "github.com/weiyinfu/MaoZeDongAnthology"
                f"@{commit[:12]}/{label}"
            ),
            "format": "md",
            "mediaType": "text/markdown; charset=utf-8",
            "sha256": source_hash,
        },
        "processing": {
            "parser": {
                "id": "agent.github-md-body-only",
                "version": f"1.0.0+{commit[:12]}",
            },
            "segmenter": {
                "id": "agent.work-reading-boundary",
                "version": "1.0.0",
                "ruleVersion": "work-reading-30s-v1",
            },
        },
        "blocks": blocks,
        "segments": segments,
    }
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIRECTORY / f"毛泽东选集-{label}-正文版.tanyue.json"
    output.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")

    segment_lengths = [
        sum(int(span["end"]) - int(span["start"]) for span in segment["spans"])
        for segment in segments
    ]
    return {
        "title": title,
        "subtitle": subtitle,
        "articleRange": [articles[0].number, articles[-1].number],
        "articleCount": len(articles),
        "blockCount": len(blocks),
        "segmentCount": len(segments),
        "unicodeScalarCount": sum(article.body_chars for article in articles),
        "removedNoteCharacters": sum(article.removed_note_chars for article in articles),
        "removedEditorCharacters": sum(article.removed_editor_chars for article in articles),
        "removedInlineNoteReferences": sum(
            article.removed_reference_count for article in articles
        ),
        "coveragePercent": 100,
        "segmentLength": {
            "minimum": min(segment_lengths),
            "maximum": max(segment_lengths),
            "average": round(sum(segment_lengths) / len(segment_lengths), 1),
        },
        "output": str(output),
    }


def main() -> None:
    paths = ordered_sources()
    commit = repository_commit()
    source_hash = raw_source_hash(paths)
    articles = [clean_article(path) for path in paths]
    by_number = {article.number: article for article in articles}
    reports = []
    for label, subtitle, first, last in VOLUMES:
        reports.append(
            create_volume(
                label,
                subtitle,
                [by_number[number] for number in range(first, last + 1)],
                commit,
                source_hash,
            )
        )

    report = {
        "repository": "https://github.com/weiyinfu/MaoZeDongAnthology",
        "commit": commit,
        "rawSourceSha256": source_hash,
        "articleCount": len(articles),
        "cleaningPolicy": {
            "removed": [
                "文章标题（转为章节标题）",
                "成文日期",
                "篇首编者说明块",
                "文末横线、注释标题及全部注释",
                "正文内与已删除注释对应的数字注号",
                "Markdown 展示标记",
            ],
            "preserved": "正文段落、正文内部小标题、列表内容与原始顺序；未进行 AI 改写。",
        },
        "totals": {
            "rawUnicodeScalarCount": sum(article.raw_chars for article in articles),
            "bodyUnicodeScalarCount": sum(article.body_chars for article in articles),
            "removedNoteCharacters": sum(
                article.removed_note_chars for article in articles
            ),
            "removedEditorCharacters": sum(
                article.removed_editor_chars for article in articles
            ),
            "removedInlineNoteReferences": sum(
                article.removed_reference_count for article in articles
            ),
        },
        "volumes": reports,
    }
    report_path = OUTPUT_DIRECTORY / "毛泽东选集-正文版.import-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
