use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DATABASE_FILENAME: &str = "tanyue.sqlite3";
const DATABASE_SCHEMA_VERSION: i64 = 2;

type RepositoryResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    schema_version: i64,
    #[serde(default)]
    content_seed_version: i64,
    books: Vec<Value>,
    segments: Vec<Value>,
    active_book_id: String,
    current_segment_id: String,
    schedule: Value,
    settings: Value,
    events: Vec<Value>,
    selected_view: String,
    last_opened_at: String,
    onboarding_complete: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationOutcome {
    status: String,
    backup_path: Option<String>,
    book_count: usize,
    segment_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDiagnostics {
    database_path: String,
    database_exists: bool,
    schema_version: i64,
    book_count: i64,
    segment_count: i64,
    migration_count: i64,
}

fn required_string(value: &Value, key: &str, entity: &str) -> RepositoryResult<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{entity} is missing a valid {key}"))
}

fn required_i64(value: &Value, key: &str, entity: &str) -> RepositoryResult<i64> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("{entity} is missing a valid {key}"))
}

fn required_bool(value: &Value, key: &str, entity: &str) -> RepositoryResult<bool> {
    value
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("{entity} is missing a valid {key}"))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn parse_state(state_json: &str) -> RepositoryResult<PersistedState> {
    let state: PersistedState = serde_json::from_str(state_json)
        .map_err(|error| format!("invalid app state JSON: {error}"))?;
    validate_state(&state)?;
    Ok(state)
}

fn validate_state(state: &PersistedState) -> RepositoryResult<()> {
    if state.schema_version != 1 {
        return Err(format!(
            "unsupported app state schema version: {}",
            state.schema_version
        ));
    }
    if !state.schedule.is_object() || !state.settings.is_object() {
        return Err("schedule and settings must be JSON objects".into());
    }
    if state.content_seed_version < 0 {
        return Err("contentSeedVersion must not be negative".into());
    }

    let mut book_ids = HashSet::new();
    for book in &state.books {
        let id = required_string(book, "id", "book")?;
        required_string(book, "title", &format!("book {id}"))?;
        required_string(book, "updatedAt", &format!("book {id}"))?;
        if !book_ids.insert(id.clone()) {
            return Err(format!("duplicate book id: {id}"));
        }
    }

    if book_ids.is_empty() {
        if !state.active_book_id.is_empty() {
            return Err("activeBookId must be empty when the bookshelf is empty".into());
        }
    } else if !book_ids.contains(&state.active_book_id) {
        return Err("activeBookId does not reference an existing book".into());
    }

    let mut segment_ids = HashSet::new();
    let mut sequences: HashMap<String, Vec<i64>> = HashMap::new();
    for segment in &state.segments {
        let id = required_string(segment, "id", "segment")?;
        let book_id = required_string(segment, "bookId", &format!("segment {id}"))?;
        let sequence = required_i64(segment, "sequence", &format!("segment {id}"))?;
        let status = required_string(segment, "status", &format!("segment {id}"))?;
        required_bool(segment, "favorite", &format!("segment {id}"))?;
        required_string(segment, "contentHash", &format!("segment {id}"))?;
        if !matches!(status.as_str(), "unread" | "shown" | "confirmed") {
            return Err(format!("segment {id} has invalid status"));
        }
        if sequence <= 0 || !book_ids.contains(&book_id) {
            return Err(format!("segment {id} has an invalid bookId or sequence"));
        }
        if !segment_ids.insert(id.clone()) {
            return Err(format!("duplicate segment id: {id}"));
        }
        sequences.entry(book_id).or_default().push(sequence);
    }

    if segment_ids.is_empty() {
        if !state.current_segment_id.is_empty() {
            return Err("currentSegmentId must be empty when there are no segments".into());
        }
    } else if !segment_ids.contains(&state.current_segment_id) {
        return Err("currentSegmentId does not reference an existing segment".into());
    }
    for (book_id, mut values) in sequences {
        values.sort_unstable();
        if values
            .iter()
            .enumerate()
            .any(|(index, value)| *value != index as i64 + 1)
        {
            return Err(format!(
                "book {book_id} has non-contiguous segment sequence"
            ));
        }
    }

    let mut event_ids = HashSet::new();
    for event in &state.events {
        let id = required_string(event, "id", "event")?;
        required_string(event, "createdAt", &format!("event {id}"))?;
        if !event_ids.insert(id.clone()) {
            return Err(format!("duplicate event id: {id}"));
        }
    }
    Ok(())
}

fn apply_schema(connection: &mut Connection) -> RepositoryResult<()> {
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("failed to enable foreign keys: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("failed to configure SQLite timeout: {error}"))?;
    let mut version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("failed to read schema version: {error}"))?;
    if version > DATABASE_SCHEMA_VERSION {
        return Err(format!(
            "database schema {version} is newer than this application"
        ));
    }
    if version == 0 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start schema migration v1: {error}"))?;
        transaction
            .execute_batch(
                r#"
            CREATE TABLE IF NOT EXISTS app_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              schema_version INTEGER NOT NULL,
              active_book_id TEXT NOT NULL,
              current_segment_id TEXT NOT NULL,
              schedule_json TEXT NOT NULL,
              settings_json TEXT NOT NULL,
              selected_view TEXT NOT NULL,
              last_opened_at TEXT NOT NULL,
              onboarding_complete INTEGER NOT NULL CHECK (onboarding_complete IN (0, 1))
            );
            CREATE TABLE IF NOT EXISTS books (
              id TEXT PRIMARY KEY,
              position INTEGER NOT NULL UNIQUE,
              title TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS segments (
              id TEXT PRIMARY KEY,
              position INTEGER NOT NULL UNIQUE,
              book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
              sequence INTEGER NOT NULL CHECK (sequence > 0),
              status TEXT NOT NULL CHECK (status IN ('unread', 'shown', 'confirmed')),
              favorite INTEGER NOT NULL CHECK (favorite IN (0, 1)),
              content_hash TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              UNIQUE (book_id, sequence)
            );
            CREATE TABLE IF NOT EXISTS reading_events (
              id TEXT PRIMARY KEY,
              position INTEGER NOT NULL UNIQUE,
              book_id TEXT,
              segment_id TEXT,
              created_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS persistence_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS migration_backups (
              id TEXT PRIMARY KEY,
              source_key TEXT NOT NULL UNIQUE,
              backup_path TEXT NOT NULL,
              sha256 TEXT NOT NULL,
              book_count INTEGER NOT NULL,
              segment_count INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              applied_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_segments_book_status ON segments(book_id, status);
            CREATE INDEX IF NOT EXISTS idx_segments_favorite ON segments(favorite);
            CREATE INDEX IF NOT EXISTS idx_events_created_at ON reading_events(created_at);
            PRAGMA user_version = 1;
            "#,
            )
            .map_err(|error| format!("failed to apply schema migration v1: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit schema migration v1: {error}"))?;
        version = 1;
    }

    if version == 1 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start schema migration v2: {error}"))?;
        transaction
            .execute_batch(
                r#"
                ALTER TABLE app_state ADD COLUMN content_seed_version INTEGER NOT NULL DEFAULT 0;
                PRAGMA user_version = 2;
                "#,
            )
            .map_err(|error| format!("failed to apply schema migration v2: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit schema migration v2: {error}"))?;
    }
    Ok(())
}

fn open_database(path: &Path) -> RepositoryResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
    }
    let mut connection = Connection::open(path)
        .map_err(|error| format!("failed to open SQLite database: {error}"))?;
    apply_schema(&mut connection)?;
    Ok(connection)
}

fn save_state_transaction(
    transaction: &Transaction<'_>,
    state: &PersistedState,
) -> RepositoryResult<()> {
    transaction
        .execute("DELETE FROM reading_events", [])
        .map_err(|error| format!("failed to clear events: {error}"))?;
    transaction
        .execute("DELETE FROM segments", [])
        .map_err(|error| format!("failed to clear segments: {error}"))?;
    transaction
        .execute("DELETE FROM books", [])
        .map_err(|error| format!("failed to clear books: {error}"))?;

    {
        let mut statement = transaction
            .prepare("INSERT INTO books (id, position, title, updated_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(|error| format!("failed to prepare book insert: {error}"))?;
        for (position, book) in state.books.iter().enumerate() {
            let id = required_string(book, "id", "book")?;
            let title = required_string(book, "title", &format!("book {id}"))?;
            let updated_at = required_string(book, "updatedAt", &format!("book {id}"))?;
            let payload = serde_json::to_string(book)
                .map_err(|error| format!("failed to serialize book {id}: {error}"))?;
            statement
                .execute(params![id, position as i64, title, updated_at, payload])
                .map_err(|error| format!("failed to save book: {error}"))?;
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO segments (id, position, book_id, sequence, status, favorite, content_hash, payload_json) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|error| format!("failed to prepare segment insert: {error}"))?;
        for (position, segment) in state.segments.iter().enumerate() {
            let id = required_string(segment, "id", "segment")?;
            let book_id = required_string(segment, "bookId", &format!("segment {id}"))?;
            let sequence = required_i64(segment, "sequence", &format!("segment {id}"))?;
            let status = required_string(segment, "status", &format!("segment {id}"))?;
            let favorite = required_bool(segment, "favorite", &format!("segment {id}"))?;
            let content_hash = required_string(segment, "contentHash", &format!("segment {id}"))?;
            let payload = serde_json::to_string(segment)
                .map_err(|error| format!("failed to serialize segment {id}: {error}"))?;
            statement
                .execute(params![
                    id,
                    position as i64,
                    book_id,
                    sequence,
                    status,
                    i64::from(favorite),
                    content_hash,
                    payload
                ])
                .map_err(|error| format!("failed to save segment: {error}"))?;
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO reading_events (id, position, book_id, segment_id, created_at, payload_json) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|error| format!("failed to prepare event insert: {error}"))?;
        for (position, event) in state.events.iter().enumerate() {
            let id = required_string(event, "id", "event")?;
            let created_at = required_string(event, "createdAt", &format!("event {id}"))?;
            let payload = serde_json::to_string(event)
                .map_err(|error| format!("failed to serialize event {id}: {error}"))?;
            statement
                .execute(params![
                    id,
                    position as i64,
                    optional_string(event, "bookId"),
                    optional_string(event, "segmentId"),
                    created_at,
                    payload
                ])
                .map_err(|error| format!("failed to save event: {error}"))?;
        }
    }

    transaction
        .execute(
            "INSERT INTO app_state (id, schema_version, content_seed_version, active_book_id, current_segment_id, schedule_json, settings_json, selected_view, last_opened_at, onboarding_complete) \
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version, content_seed_version=excluded.content_seed_version, active_book_id=excluded.active_book_id, \
             current_segment_id=excluded.current_segment_id, schedule_json=excluded.schedule_json, settings_json=excluded.settings_json, \
             selected_view=excluded.selected_view, last_opened_at=excluded.last_opened_at, onboarding_complete=excluded.onboarding_complete",
            params![
                state.schema_version,
                state.content_seed_version,
                state.active_book_id,
                state.current_segment_id,
                serde_json::to_string(&state.schedule).map_err(|error| error.to_string())?,
                serde_json::to_string(&state.settings).map_err(|error| error.to_string())?,
                state.selected_view,
                state.last_opened_at,
                i64::from(state.onboarding_complete)
            ],
        )
        .map_err(|error| format!("failed to save app state: {error}"))?;
    transaction
        .execute(
            "INSERT INTO persistence_meta (key, value, updated_at) VALUES ('last_saved_at', ?1, ?1) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![state.last_opened_at],
        )
        .map_err(|error| format!("failed to save persistence metadata: {error}"))?;
    Ok(())
}

fn save_state(connection: &mut Connection, state_json: &str) -> RepositoryResult<()> {
    let state = parse_state(state_json)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("failed to start state transaction: {error}"))?;
    save_state_transaction(&transaction, &state)?;
    transaction
        .commit()
        .map_err(|error| format!("failed to commit app state: {error}"))
}

fn read_payloads(connection: &Connection, sql: &str) -> RepositoryResult<Vec<Value>> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("failed to prepare state query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query state rows: {error}"))?;
    let mut values = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("failed to read state row: {error}"))?;
        values.push(
            serde_json::from_str(&payload)
                .map_err(|error| format!("database contains invalid JSON payload: {error}"))?,
        );
    }
    Ok(values)
}

fn load_state(connection: &Connection) -> RepositoryResult<Option<String>> {
    let app_row = connection
        .query_row(
            "SELECT schema_version, content_seed_version, active_book_id, current_segment_id, schedule_json, settings_json, selected_view, last_opened_at, onboarding_complete FROM app_state WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to read app state: {error}"))?;
    let Some((
        schema_version,
        content_seed_version,
        active_book_id,
        current_segment_id,
        schedule_json,
        settings_json,
        selected_view,
        last_opened_at,
        onboarding_complete,
    )) = app_row
    else {
        return Ok(None);
    };

    let state = PersistedState {
        schema_version,
        content_seed_version,
        books: read_payloads(
            connection,
            "SELECT payload_json FROM books ORDER BY position",
        )?,
        segments: read_payloads(
            connection,
            "SELECT payload_json FROM segments ORDER BY position",
        )?,
        active_book_id,
        current_segment_id,
        schedule: serde_json::from_str(&schedule_json)
            .map_err(|error| format!("database contains invalid schedule JSON: {error}"))?,
        settings: serde_json::from_str(&settings_json)
            .map_err(|error| format!("database contains invalid settings JSON: {error}"))?,
        events: read_payloads(
            connection,
            "SELECT payload_json FROM reading_events ORDER BY position",
        )?,
        selected_view,
        last_opened_at,
        onboarding_complete: onboarding_complete != 0,
    };
    validate_state(&state)?;
    serde_json::to_string(&state)
        .map(Some)
        .map_err(|error| format!("failed to serialize loaded app state: {error}"))
}

fn database_path(app: &AppHandle) -> RepositoryResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(DATABASE_FILENAME))
        .map_err(|error| format!("failed to resolve app data directory: {error}"))
}

fn unix_millis() -> RepositoryResult<u128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| format!("system clock is before UNIX epoch: {error}"))
}

fn sha256_hex(content: &[u8]) -> String {
    Sha256::digest(content)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn write_migration_backup(
    app_data_dir: &Path,
    original_json: &str,
) -> RepositoryResult<(PathBuf, String, String)> {
    let backup_dir = app_data_dir.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("failed to create migration backup directory: {error}"))?;
    let sha256 = sha256_hex(original_json.as_bytes());
    let timestamp = unix_millis()?;
    let id = format!("migration_{timestamp}_{}", &sha256[..12]);
    let final_path = backup_dir.join(format!(
        "localstorage-v1-{timestamp}-{}.json",
        &sha256[..12]
    ));
    let temporary_path = backup_dir.join(format!(".{id}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .map_err(|error| format!("failed to create migration backup: {error}"))?;
    file.write_all(original_json.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to write migration backup: {error}"))?;
    if let Err(error) = fs::rename(&temporary_path, &final_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("failed to finalize migration backup: {error}"));
    }
    Ok((final_path, sha256, id))
}

fn backup_before_content_seed_upgrade(
    connection: &Connection,
    app_data_dir: &Path,
    incoming_state_json: &str,
) -> RepositoryResult<Option<PathBuf>> {
    let incoming = parse_state(incoming_state_json)?;
    let Some(current_json) = load_state(connection)? else {
        return Ok(None);
    };
    let current = parse_state(&current_json)?;
    if incoming.content_seed_version <= current.content_seed_version {
        return Ok(None);
    }

    let backup_key = format!(
        "content_seed_backup:{}:{}",
        current.content_seed_version, incoming.content_seed_version
    );
    let existing = connection
        .query_row(
            "SELECT value FROM persistence_meta WHERE key = ?1",
            params![backup_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to inspect content seed backup: {error}"))?;
    if let Some(path) = existing {
        return Ok(Some(PathBuf::from(path)));
    }

    let backup_dir = app_data_dir.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("failed to create content seed backup directory: {error}"))?;
    let sha256 = sha256_hex(current_json.as_bytes());
    let timestamp = unix_millis()?;
    let stem = format!(
        "content-seed-v{}-to-v{}-{timestamp}-{}",
        current.content_seed_version,
        incoming.content_seed_version,
        &sha256[..12]
    );
    let final_path = backup_dir.join(format!("{stem}.json"));
    let temporary_path = backup_dir.join(format!(".{stem}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .map_err(|error| format!("failed to create content seed backup: {error}"))?;
    file.write_all(current_json.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to write content seed backup: {error}"))?;
    if let Err(error) = fs::rename(&temporary_path, &final_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("failed to finalize content seed backup: {error}"));
    }
    connection
        .execute(
            "INSERT INTO persistence_meta (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![
                backup_key,
                final_path.to_string_lossy(),
                incoming.last_opened_at
            ],
        )
        .map_err(|error| format!("failed to record content seed backup: {error}"))?;
    Ok(Some(final_path))
}

fn import_legacy_state(
    connection: &mut Connection,
    source_key: &str,
    normalized_state_json: &str,
    backup_path: &Path,
    sha256: &str,
    backup_id: &str,
) -> RepositoryResult<MigrationOutcome> {
    if let Some(existing) = connection
        .query_row(
            "SELECT backup_path FROM migration_backups WHERE source_key = ?1",
            params![source_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to check migration state: {error}"))?
    {
        let counts = current_counts(connection)?;
        return Ok(MigrationOutcome {
            status: "already_migrated".into(),
            backup_path: Some(existing),
            book_count: counts.0 as usize,
            segment_count: counts.1 as usize,
        });
    }
    let existing_state: i64 = connection
        .query_row("SELECT COUNT(*) FROM app_state", [], |row| row.get(0))
        .map_err(|error| format!("failed to inspect database state: {error}"))?;
    if existing_state > 0 {
        let counts = current_counts(connection)?;
        return Ok(MigrationOutcome {
            status: "database_not_empty".into(),
            backup_path: None,
            book_count: counts.0 as usize,
            segment_count: counts.1 as usize,
        });
    }

    let state = parse_state(normalized_state_json)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("failed to start legacy migration: {error}"))?;
    save_state_transaction(&transaction, &state)?;
    transaction
        .execute(
            "INSERT INTO migration_backups (id, source_key, backup_path, sha256, book_count, segment_count, created_at, applied_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                backup_id,
                source_key,
                backup_path.to_string_lossy(),
                sha256,
                state.books.len() as i64,
                state.segments.len() as i64,
                state.last_opened_at
            ],
        )
        .map_err(|error| format!("failed to record migration backup: {error}"))?;
    transaction
        .execute(
            "INSERT INTO persistence_meta (key, value, updated_at) VALUES (?1, 'complete', ?2)",
            params![
                format!("localstorage_migration:{source_key}"),
                state.last_opened_at
            ],
        )
        .map_err(|error| format!("failed to record migration completion: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("failed to commit legacy migration: {error}"))?;
    Ok(MigrationOutcome {
        status: "migrated".into(),
        backup_path: Some(backup_path.to_string_lossy().into_owned()),
        book_count: state.books.len(),
        segment_count: state.segments.len(),
    })
}

fn current_counts(connection: &Connection) -> RepositoryResult<(i64, i64)> {
    let books = connection
        .query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))
        .map_err(|error| format!("failed to count books: {error}"))?;
    let segments = connection
        .query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0))
        .map_err(|error| format!("failed to count segments: {error}"))?;
    Ok((books, segments))
}

#[tauri::command]
pub async fn load_app_state(app: AppHandle) -> RepositoryResult<Option<String>> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_database(&path)?;
        load_state(&connection)
    })
    .await
    .map_err(|error| format!("state load task failed: {error}"))?
}

#[tauri::command]
pub async fn save_app_state(app: AppHandle, state_json: String) -> RepositoryResult<()> {
    let path = database_path(&app)?;
    let app_data_dir = path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "database path has no parent directory".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_database(&path)?;
        backup_before_content_seed_upgrade(&connection, &app_data_dir, &state_json)?;
        save_state(&mut connection, &state_json)
    })
    .await
    .map_err(|error| format!("state save task failed: {error}"))?
}

#[tauri::command]
pub async fn reset_app_state(app: AppHandle) -> RepositoryResult<()> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_database(&path)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("failed to start reset transaction: {error}"))?;
        transaction
            .execute("DELETE FROM reading_events", [])
            .and_then(|_| transaction.execute("DELETE FROM segments", []))
            .and_then(|_| transaction.execute("DELETE FROM books", []))
            .and_then(|_| transaction.execute("DELETE FROM app_state", []))
            .map_err(|error| format!("failed to reset app state: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit reset: {error}"))
    })
    .await
    .map_err(|error| format!("state reset task failed: {error}"))?
}

#[tauri::command]
pub async fn migrate_legacy_state(
    app: AppHandle,
    source_key: String,
    original_state_json: String,
    normalized_state_json: String,
) -> RepositoryResult<MigrationOutcome> {
    if source_key.len() > 128 || source_key.contains(['/', '\\']) {
        return Err("invalid LocalStorage source key".into());
    }
    let path = database_path(&app)?;
    let app_data_dir = path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "database path has no parent directory".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_database(&path)?;
        if connection
            .query_row(
                "SELECT COUNT(*) FROM migration_backups WHERE source_key = ?1",
                params![source_key],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("failed to inspect migration history: {error}"))?
            > 0
        {
            let counts = current_counts(&connection)?;
            return Ok(MigrationOutcome {
                status: "already_migrated".into(),
                backup_path: None,
                book_count: counts.0 as usize,
                segment_count: counts.1 as usize,
            });
        }
        let (backup_path, sha256, backup_id) =
            write_migration_backup(&app_data_dir, &original_state_json)?;
        import_legacy_state(
            &mut connection,
            &source_key,
            &normalized_state_json,
            &backup_path,
            &sha256,
            &backup_id,
        )
    })
    .await
    .map_err(|error| format!("legacy migration task failed: {error}"))?
}

#[tauri::command]
pub async fn storage_diagnostics(app: AppHandle) -> RepositoryResult<StorageDiagnostics> {
    let path = database_path(&app)?;
    let path_for_result = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let existed = path.exists();
        let connection = open_database(&path)?;
        let schema_version = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| format!("failed to read schema version: {error}"))?;
        let counts = current_counts(&connection)?;
        let migration_count = connection
            .query_row("SELECT COUNT(*) FROM migration_backups", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("failed to count migrations: {error}"))?;
        Ok(StorageDiagnostics {
            database_path: path_for_result.to_string_lossy().into_owned(),
            database_exists: existed || path_for_result.exists(),
            schema_version,
            book_count: counts.0,
            segment_count: counts.1,
            migration_count,
        })
    })
    .await
    .map_err(|error| format!("storage diagnostics task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_state_json() -> String {
        json!({
            "schemaVersion": 1,
            "contentSeedVersion": 2,
            "books": [{
                "id": "book_1", "title": "Test", "updatedAt": "2026-08-27T00:00:00.000Z"
            }],
            "segments": [{
                "id": "segment_1", "bookId": "book_1", "sequence": 1, "status": "unread",
                "favorite": false, "contentHash": "hash_1", "note": "note"
            }],
            "activeBookId": "book_1",
            "currentSegmentId": "segment_1",
            "schedule": {"enabled": true},
            "settings": {"theme": "system"},
            "events": [{"id": "event_1", "createdAt": "2026-08-27T00:00:00.000Z"}],
            "selectedView": "today",
            "lastOpenedAt": "2026-08-27T00:00:00.000Z",
            "onboardingComplete": true
        })
        .to_string()
    }

    fn memory_database() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        apply_schema(&mut connection).expect("apply schema");
        connection
    }

    #[test]
    fn schema_is_idempotent() {
        let mut connection = memory_database();
        apply_schema(&mut connection).expect("apply schema twice");
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read version");
        assert_eq!(version, DATABASE_SCHEMA_VERSION);
    }

    #[test]
    fn schema_v1_upgrades_content_seed_version_without_losing_state() {
        let mut connection = Connection::open_in_memory().expect("open v1 database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE app_state (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  schema_version INTEGER NOT NULL,
                  active_book_id TEXT NOT NULL,
                  current_segment_id TEXT NOT NULL,
                  schedule_json TEXT NOT NULL,
                  settings_json TEXT NOT NULL,
                  selected_view TEXT NOT NULL,
                  last_opened_at TEXT NOT NULL,
                  onboarding_complete INTEGER NOT NULL CHECK (onboarding_complete IN (0, 1))
                );
                INSERT INTO app_state VALUES (
                  1, 1, '', '', '{}', '{}', 'today', '2026-08-30T00:00:00.000Z', 1
                );
                PRAGMA user_version = 1;
                "#,
            )
            .expect("create v1 app_state");

        apply_schema(&mut connection).expect("upgrade v1 to v2");

        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read upgraded schema version");
        let content_seed_version: i64 = connection
            .query_row(
                "SELECT content_seed_version FROM app_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read migrated seed version");
        let selected_view: String = connection
            .query_row(
                "SELECT selected_view FROM app_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read preserved state");
        assert_eq!(version, DATABASE_SCHEMA_VERSION);
        assert_eq!(content_seed_version, 0);
        assert_eq!(selected_view, "today");
    }

    #[test]
    fn state_round_trip_preserves_payloads() {
        let mut connection = memory_database();
        let source = sample_state_json();
        save_state(&mut connection, &source).expect("save state");
        let loaded = load_state(&connection)
            .expect("load state")
            .expect("state exists");
        let source_value: Value = serde_json::from_str(&source).expect("source JSON");
        let loaded_value: Value = serde_json::from_str(&loaded).expect("loaded JSON");
        assert_eq!(loaded_value, source_value);
    }

    #[test]
    fn content_seed_upgrade_creates_one_recoverable_backup() {
        let mut connection = memory_database();
        let mut current: Value = serde_json::from_str(&sample_state_json()).expect("current JSON");
        current["contentSeedVersion"] = json!(0);
        save_state(&mut connection, &current.to_string()).expect("save current state");

        let backup_root = std::env::temp_dir().join(format!(
            "tanyue-content-seed-backup-{}-{}",
            std::process::id(),
            unix_millis().expect("timestamp")
        ));
        let incoming = sample_state_json();
        let first = backup_before_content_seed_upgrade(&connection, &backup_root, &incoming)
            .expect("create content backup")
            .expect("backup path");
        let second = backup_before_content_seed_upgrade(&connection, &backup_root, &incoming)
            .expect("reuse content backup")
            .expect("existing backup path");

        assert_eq!(first, second);
        let backup: Value =
            serde_json::from_str(&fs::read_to_string(&first).expect("read content seed backup"))
                .expect("parse content seed backup");
        assert_eq!(backup["contentSeedVersion"], json!(0));
        assert_eq!(backup["books"][0]["id"], json!("book_1"));
        let backup_records: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM persistence_meta WHERE key = 'content_seed_backup:0:2'",
                [],
                |row| row.get(0),
            )
            .expect("count content seed backups");
        assert_eq!(backup_records, 1);
        fs::remove_dir_all(&backup_root).expect("remove isolated backup test directory");
    }

    #[test]
    fn invalid_update_does_not_replace_previous_snapshot() {
        let mut connection = memory_database();
        let source = sample_state_json();
        save_state(&mut connection, &source).expect("save initial state");
        let mut invalid: Value = serde_json::from_str(&source).expect("parse source");
        invalid["segments"][0]["sequence"] = json!(2);
        assert!(save_state(&mut connection, &invalid.to_string()).is_err());
        let loaded = load_state(&connection)
            .expect("load state")
            .expect("state exists");
        assert_eq!(
            serde_json::from_str::<Value>(&loaded).unwrap(),
            serde_json::from_str::<Value>(&source).unwrap()
        );
    }

    #[test]
    fn empty_bookshelf_round_trip_is_valid() {
        let mut connection = memory_database();
        let source = json!({
            "schemaVersion": 1,
            "contentSeedVersion": 2,
            "books": [],
            "segments": [],
            "activeBookId": "",
            "currentSegmentId": "",
            "schedule": {"enabled": true, "nextDueAt": null, "lastTriggeredSlot": null},
            "settings": {"theme": "system"},
            "events": [],
            "selectedView": "library",
            "lastOpenedAt": "2026-08-28T00:00:00.000Z",
            "onboardingComplete": true
        })
        .to_string();

        save_state(&mut connection, &source).expect("save empty bookshelf");
        let loaded = load_state(&connection)
            .expect("load empty bookshelf")
            .expect("empty bookshelf state exists");
        assert_eq!(
            serde_json::from_str::<Value>(&loaded).unwrap(),
            serde_json::from_str::<Value>(&source).unwrap()
        );
    }

    #[test]
    fn legacy_import_is_idempotent() {
        let mut connection = memory_database();
        let source = sample_state_json();
        let backup_path = Path::new("C:/temporary/backup.json");
        let first = import_legacy_state(
            &mut connection,
            "tanyue.state.v1",
            &source,
            backup_path,
            "abc123",
            "migration_1",
        )
        .expect("first migration");
        let second = import_legacy_state(
            &mut connection,
            "tanyue.state.v1",
            &source,
            backup_path,
            "abc123",
            "migration_2",
        )
        .expect("second migration");
        assert_eq!(first.status, "migrated");
        assert_eq!(second.status, "already_migrated");
        assert_eq!(current_counts(&connection).unwrap(), (1, 1));
    }
}
