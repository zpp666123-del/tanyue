use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub const IMPORT_SCHEMA: &str = include_str!("../../public/tanyue-import.schema.json");
const MAX_PACKAGE_BYTES: usize = 50_000_000;
const MAX_ITEMS: usize = 100_000;
const APP_IDENTIFIER: &str = "com.generalconsulting.tanyue";

type ImportResult<T> = Result<T, String>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentImportPackage {
    schema_version: u32,
    offset_unit: String,
    book: PackageBook,
    source: PackageSource,
    processing: PackageProcessing,
    blocks: Vec<PackageBlock>,
    segments: Vec<PackageSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackageBook {
    title: String,
    author: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageSource {
    name: String,
    format: String,
    media_type: Option<String>,
    sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackageProcessing {
    parser: VersionedProcessor,
    segmenter: SegmenterProcessor,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct VersionedProcessor {
    id: String,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SegmenterProcessor {
    id: String,
    version: String,
    rule_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageBlock {
    id: String,
    sequence: usize,
    #[serde(rename = "type")]
    block_type: String,
    text: String,
    source_anchor: PackageAnchor,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackageAnchor {
    kind: String,
    value: String,
    label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageSegment {
    sequence: usize,
    chapter_title: Option<String>,
    spans: Vec<PackageSpan>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageSpan {
    block_id: String,
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageValidation {
    pub package_id: String,
    pub title: String,
    pub block_count: usize,
    pub segment_count: usize,
    pub readable_char_count: usize,
    pub coverage_percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueOutcome {
    pub status: String,
    pub package_id: String,
    pub queue_path: String,
    pub block_count: usize,
    pub segment_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingImportPackage {
    pub id: String,
    pub json: String,
    pub error: Option<String>,
}

fn non_empty(value: &str, path: &str, maximum: usize) -> ImportResult<()> {
    let length = value.trim().chars().count();
    if length == 0 || length > maximum {
        return Err(format!("{path} must contain 1 to {maximum} characters"));
    }
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|item| item.is_ascii_hexdigit())
}

fn package_hash(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

pub fn validate_import_package(raw: &str) -> ImportResult<PackageValidation> {
    if raw.len() > MAX_PACKAGE_BYTES {
        return Err(format!(
            "package exceeds the {MAX_PACKAGE_BYTES} byte limit"
        ));
    }
    let package: AgentImportPackage =
        serde_json::from_str(raw).map_err(|error| format!("invalid package JSON: {error}"))?;
    if package.schema_version != 1 {
        return Err(format!(
            "unsupported schemaVersion: {}",
            package.schema_version
        ));
    }
    if package.offset_unit != "unicode-scalar" {
        return Err("offsetUnit must be unicode-scalar".into());
    }
    non_empty(&package.book.title, "book.title", 300)?;
    if let Some(author) = &package.book.author {
        non_empty(author, "book.author", 300)?;
    }
    non_empty(&package.source.name, "source.name", 1000)?;
    if !matches!(
        package.source.format.as_str(),
        "txt" | "md" | "url" | "pdf" | "docx" | "epub" | "json"
    ) {
        return Err("source.format is not supported".into());
    }
    if let Some(media_type) = &package.source.media_type {
        non_empty(media_type, "source.mediaType", 200)?;
    }
    if let Some(hash) = &package.source.sha256 {
        if !valid_sha256(hash) {
            return Err("source.sha256 must be 64 hexadecimal characters".into());
        }
    }
    non_empty(&package.processing.parser.id, "processing.parser.id", 200)?;
    non_empty(
        &package.processing.parser.version,
        "processing.parser.version",
        100,
    )?;
    non_empty(
        &package.processing.segmenter.id,
        "processing.segmenter.id",
        200,
    )?;
    non_empty(
        &package.processing.segmenter.version,
        "processing.segmenter.version",
        100,
    )?;
    non_empty(
        &package.processing.segmenter.rule_version,
        "processing.segmenter.ruleVersion",
        100,
    )?;

    if package.blocks.is_empty() || package.blocks.len() > MAX_ITEMS {
        return Err(format!("blocks must contain 1 to {MAX_ITEMS} items"));
    }
    if package.segments.is_empty() || package.segments.len() > MAX_ITEMS {
        return Err(format!("segments must contain 1 to {MAX_ITEMS} items"));
    }

    let mut ids = HashSet::new();
    let mut block_meta: HashMap<&str, (usize, usize, bool)> = HashMap::new();
    let mut readable_char_count = 0usize;
    for (index, block) in package.blocks.iter().enumerate() {
        if block.sequence != index + 1 {
            return Err(format!("blocks[{index}].sequence must equal {}", index + 1));
        }
        non_empty(&block.id, &format!("blocks[{index}].id"), 200)?;
        if !ids.insert(block.id.as_str()) {
            return Err(format!("duplicate block id: {}", block.id));
        }
        if !matches!(block.block_type.as_str(), "heading" | "paragraph" | "list") {
            return Err(format!("blocks[{index}].type is not supported"));
        }
        non_empty(
            &block.text,
            &format!("blocks[{index}].text"),
            MAX_PACKAGE_BYTES,
        )?;
        if !matches!(
            block.source_anchor.kind.as_str(),
            "chapter" | "line" | "page" | "cfi" | "url"
        ) {
            return Err(format!(
                "blocks[{index}].sourceAnchor.kind is not supported"
            ));
        }
        non_empty(
            &block.source_anchor.value,
            &format!("blocks[{index}].sourceAnchor.value"),
            1000,
        )?;
        non_empty(
            &block.source_anchor.label,
            &format!("blocks[{index}].sourceAnchor.label"),
            1000,
        )?;
        let scalar_count = block.text.chars().count();
        let readable = block.block_type != "heading";
        if readable {
            readable_char_count = readable_char_count
                .checked_add(scalar_count)
                .ok_or_else(|| "readable character count overflow".to_string())?;
        }
        block_meta.insert(block.id.as_str(), (index, scalar_count, readable));
    }
    if readable_char_count == 0 {
        return Err("package has no readable text blocks".into());
    }
    if readable_char_count > MAX_PACKAGE_BYTES {
        return Err(format!(
            "readable text exceeds the {MAX_PACKAGE_BYTES} character limit"
        ));
    }

    let mut cursors: HashMap<&str, usize> = package
        .blocks
        .iter()
        .filter(|block| block.block_type != "heading")
        .map(|block| (block.id.as_str(), 0))
        .collect();
    let mut previous: Option<(usize, usize)> = None;
    for (segment_index, segment) in package.segments.iter().enumerate() {
        if segment.sequence != segment_index + 1 {
            return Err(format!(
                "segments[{segment_index}].sequence must equal {}",
                segment_index + 1
            ));
        }
        if let Some(title) = &segment.chapter_title {
            non_empty(
                title,
                &format!("segments[{segment_index}].chapterTitle"),
                300,
            )?;
        }
        if segment.spans.is_empty() {
            return Err(format!("segments[{segment_index}].spans cannot be empty"));
        }
        for (span_index, span) in segment.spans.iter().enumerate() {
            let Some((order, length, readable)) = block_meta.get(span.block_id.as_str()).copied()
            else {
                return Err(format!(
                    "segments[{segment_index}].spans[{span_index}] references an unknown block"
                ));
            };
            if !readable {
                return Err(format!(
                    "segments[{segment_index}].spans[{span_index}] references a heading"
                ));
            }
            if span.end <= span.start || span.end > length {
                return Err(format!(
                    "segments[{segment_index}].spans[{span_index}] has an invalid range"
                ));
            }
            if let Some((previous_order, previous_end)) = previous {
                if order < previous_order || (order == previous_order && span.start < previous_end)
                {
                    return Err(format!(
                        "segments[{segment_index}].spans[{span_index}] is duplicated or out of order"
                    ));
                }
            }
            let cursor = cursors
                .get_mut(span.block_id.as_str())
                .ok_or_else(|| "coverage cursor is unavailable".to_string())?;
            if span.start != *cursor {
                return Err(format!(
                    "segments[{segment_index}].spans[{span_index}] leaves a gap or overlap"
                ));
            }
            *cursor = span.end;
            previous = Some((order, span.end));
        }
    }
    for block in package
        .blocks
        .iter()
        .filter(|block| block.block_type != "heading")
    {
        let cursor = cursors.get(block.id.as_str()).copied().unwrap_or(0);
        let length = block.text.chars().count();
        if cursor != length {
            return Err(format!("block {} is not fully covered", block.id));
        }
    }

    Ok(PackageValidation {
        package_id: package_hash(raw),
        title: package.book.title.trim().to_string(),
        block_count: package.blocks.len(),
        segment_count: package.segments.len(),
        readable_char_count,
        coverage_percent: 100,
    })
}

pub fn default_app_data_dir() -> ImportResult<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join("Library").join("Application Support"));
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|path| path.join(".config"))
        });
    base.map(|path| path.join(APP_IDENTIFIER))
        .ok_or_else(|| "cannot determine the application data directory".to_string())
}

fn pending_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("agent-import").join("pending")
}

fn rejected_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("agent-import").join("rejected")
}

pub fn queue_import_package(raw: &str, app_data_dir: &Path) -> ImportResult<QueueOutcome> {
    let validation = validate_import_package(raw)?;
    let directory = pending_dir(app_data_dir);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create import inbox: {error}"))?;
    let final_path = directory.join(format!("{}.tanyue.json", validation.package_id));
    let status = if final_path.exists() {
        "already_queued"
    } else {
        let temporary = directory.join(format!(
            ".{}.{}.tmp",
            validation.package_id,
            std::process::id()
        ));
        fs::write(&temporary, raw.as_bytes())
            .map_err(|error| format!("failed to write import package: {error}"))?;
        if let Err(error) = fs::rename(&temporary, &final_path) {
            let _ = fs::remove_file(&temporary);
            if !final_path.exists() {
                return Err(format!("failed to commit import package: {error}"));
            }
        }
        "queued"
    };
    Ok(QueueOutcome {
        status: status.into(),
        package_id: validation.package_id,
        queue_path: final_path.to_string_lossy().into_owned(),
        block_count: validation.block_count,
        segment_count: validation.segment_count,
    })
}

fn valid_package_id(value: &str) -> bool {
    valid_sha256(value)
}

fn pending_package_path(app_data_dir: &Path, id: &str) -> ImportResult<PathBuf> {
    if !valid_package_id(id) {
        return Err("invalid package id".into());
    }
    Ok(pending_dir(app_data_dir).join(format!("{id}.tanyue.json")))
}

pub fn read_pending_packages(app_data_dir: &Path) -> ImportResult<Vec<PendingImportPackage>> {
    let directory = pending_dir(app_data_dir);
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut paths: Vec<PathBuf> = fs::read_dir(&directory)
        .map_err(|error| format!("failed to read import inbox: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".tanyue.json"))
        })
        .collect();
    paths.sort();
    paths
        .into_iter()
        .take(20)
        .map(|path| {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "invalid import package filename".to_string())?;
            let id = name
                .strip_suffix(".tanyue.json")
                .ok_or_else(|| "invalid import package filename".to_string())?
                .to_string();
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to inspect import package: {error}"))?;
            if metadata.len() > MAX_PACKAGE_BYTES as u64 {
                return Ok(PendingImportPackage {
                    id,
                    json: String::new(),
                    error: Some("package exceeds the size limit".into()),
                });
            }
            let json = fs::read_to_string(&path)
                .map_err(|error| format!("failed to read import package: {error}"))?;
            let error = validate_import_package(&json).err();
            Ok(PendingImportPackage { id, json, error })
        })
        .collect()
}

pub fn acknowledge_package(
    app_data_dir: &Path,
    id: &str,
    accepted: bool,
    reason: Option<&str>,
) -> ImportResult<bool> {
    let source = pending_package_path(app_data_dir, id)?;
    if !source.exists() {
        return Ok(false);
    }
    if accepted {
        fs::remove_file(&source)
            .map_err(|error| format!("failed to remove imported package: {error}"))?;
        return Ok(true);
    }
    let directory = rejected_dir(app_data_dir);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create rejected import directory: {error}"))?;
    let destination = directory.join(format!("{id}.tanyue.json"));
    if destination.exists() {
        fs::remove_file(&source)
            .map_err(|error| format!("failed to remove duplicate rejected package: {error}"))?;
    } else {
        fs::rename(&source, &destination)
            .map_err(|error| format!("failed to preserve rejected package: {error}"))?;
    }
    if let Some(message) = reason.filter(|value| !value.trim().is_empty()) {
        fs::write(
            directory.join(format!("{id}.error.txt")),
            message.as_bytes(),
        )
        .map_err(|error| format!("failed to write rejection reason: {error}"))?;
    }
    Ok(true)
}

#[tauri::command]
pub fn list_pending_import_packages(app: AppHandle) -> ImportResult<Vec<PendingImportPackage>> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    read_pending_packages(&directory)
}

#[tauri::command]
pub fn acknowledge_import_package(
    app: AppHandle,
    id: String,
    accepted: bool,
    reason: Option<String>,
) -> ImportResult<bool> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    acknowledge_package(&directory, &id, accepted, reason.as_deref())
}

#[cfg(test)]
mod tests {
    use super::{
        acknowledge_package, queue_import_package, read_pending_packages, validate_import_package,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn valid_package() -> String {
        r#"{
          "schemaVersion":1,
          "offsetUnit":"unicode-scalar",
          "book":{"title":"测试书","author":"作者"},
          "source":{"name":"book.pdf","format":"pdf","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
          "processing":{"parser":{"id":"pdf-agent","version":"1"},"segmenter":{"id":"agent","version":"1","ruleVersion":"v1"}},
          "blocks":[{"id":"b1","sequence":1,"type":"paragraph","text":"正文😀完整。","sourceAnchor":{"kind":"page","value":"1","label":"第 1 页"}}],
          "segments":[{"sequence":1,"spans":[{"blockId":"b1","start":0,"end":6}]}]
        }"#.to_string()
    }

    #[test]
    fn validates_full_unicode_scalar_coverage() {
        let result = validate_import_package(&valid_package()).expect("valid package");
        assert_eq!(result.coverage_percent, 100);
        assert_eq!(result.segment_count, 1);
        assert_eq!(result.readable_char_count, 6);
    }

    #[test]
    fn rejects_incomplete_coverage() {
        let source = valid_package().replace("\"end\":6", "\"end\":5");
        assert!(validate_import_package(&source)
            .expect_err("coverage should fail")
            .contains("not fully covered"));
    }

    #[test]
    fn queues_and_acknowledges_atomically() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("tanyue-import-test-{nonce}"));
        let queued = queue_import_package(&valid_package(), &directory).expect("queue package");
        assert_eq!(queued.status, "queued");
        assert_eq!(read_pending_packages(&directory).unwrap().len(), 1);
        assert!(acknowledge_package(&directory, &queued.package_id, true, None).unwrap());
        assert!(read_pending_packages(&directory).unwrap().is_empty());
        fs::remove_dir_all(directory).unwrap();
    }
}
