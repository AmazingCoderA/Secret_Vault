use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand_core::OsRng;
use rand_core::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_FILE_SIZE: usize = 32 * 1024 * 1024;
const LOCKED: &str = "Хранилище заблокировано. Войдите снова.";
const ENCRYPTED_NAME: &str = "enc:v1:";
const ENCRYPTED_DATA: &[u8; 4] = b"VC01";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProtectionMode {
    Fast,
    Balanced,
    Strong,
    Maximum,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Forest,
    Midnight,
    Graphite,
    Ocean,
    Violet,
    Rose,
}

impl Theme {
    fn as_str(self) -> &'static str {
        match self {
            Self::Forest => "forest",
            Self::Midnight => "midnight",
            Self::Graphite => "graphite",
            Self::Ocean => "ocean",
            Self::Violet => "violet",
            Self::Rose => "rose",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "forest" => Ok(Self::Forest),
            "midnight" => Ok(Self::Midnight),
            "graphite" => Ok(Self::Graphite),
            "ocean" => Ok(Self::Ocean),
            "violet" => Ok(Self::Violet),
            "rose" => Ok(Self::Rose),
            _ => Err("Неизвестная тема.".into()),
        }
    }
}

impl ProtectionMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Balanced => "balanced",
            Self::Strong => "strong",
            Self::Maximum => "maximum",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "fast" => Ok(Self::Fast),
            "balanced" => Ok(Self::Balanced),
            "strong" => Ok(Self::Strong),
            "maximum" => Ok(Self::Maximum),
            _ => Err("Неизвестный режим защиты.".into()),
        }
    }

    fn params(self) -> Params {
        let (memory, iterations) = match self {
            Self::Fast => (16 * 1024, 2),
            Self::Balanced => (32 * 1024, 3),
            Self::Strong => (64 * 1024, 3),
            Self::Maximum => (128 * 1024, 4),
        };
        Params::new(memory, iterations, 1, Some(32)).expect("valid fixed Argon2 parameters")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub mode: ProtectionMode,
    pub chunk_kib: u32,
    pub auto_lock_secs: u32,
    pub lock_on_hide: bool,
    pub equal_hold_enabled: bool,
    pub recovery_question: Option<String>,
    pub theme: Theme,
    pub mask_file_names: bool,
    pub accent_color: String,
    pub secure_delete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mode: ProtectionMode::Balanced,
            chunk_kib: 512,
            auto_lock_secs: 300,
            lock_on_hide: true,
            equal_hold_enabled: true,
            recovery_question: None,
            theme: Theme::Forest,
            mask_file_names: false,
            accent_color: "#9be8c4".into(),
            secure_delete: true,
        }
    }
}

impl Settings {
    fn validate(&self) -> Result<()> {
        if ![256, 512, 1024].contains(&self.chunk_kib)
            || ![60, 300, 900].contains(&self.auto_lock_secs)
        {
            return Err("Некорректные настройки.".into());
        }
        if self.accent_color.len() != 7
            || !self.accent_color.starts_with('#')
            || !self.accent_color[1..]
                .chars()
                .all(|c| c.is_ascii_hexdigit())
        {
            return Err("Некорректный цвет интерфейса.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub added_at: u64,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub files: Vec<VaultFile>,
    pub settings: Settings,
}

#[derive(Serialize)]
pub struct Login {
    pub token: String,
    pub snapshot: Snapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub configured: bool,
    pub equal_hold_enabled: bool,
    pub recovery_question: Option<String>,
    pub theme: Theme,
}

struct Session {
    token: String,
    last_activity: Instant,
    timeout: Duration,
    key: Zeroizing<[u8; 32]>,
}
#[derive(Default)]
struct Attempts {
    failures: u32,
    retry_at: Option<Instant>,
}

struct WrappedKey {
    salt: Vec<u8>,
    nonce: Vec<u8>,
    data: Vec<u8>,
}

pub struct Store {
    db: Mutex<Connection>,
    session: Mutex<Option<Session>>,
    epoch: AtomicU64,
    attempts: Mutex<Attempts>,
    // Serializes costly KDF work, but never blocks Emergency Lock.
    auth: Mutex<()>,
}

fn db_error(error: rusqlite::Error) -> String {
    format!("Ошибка локального хранилища: {error}")
}
fn guard<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| "Внутренняя ошибка. Перезапустите приложение.".into())
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path).map_err(db_error)?;
        db.execute_batch(
            "PRAGMA journal_mode = DELETE;
             PRAGMA secure_delete = ON;
             CREATE TABLE IF NOT EXISTS config (
               id INTEGER PRIMARY KEY CHECK(id = 1), password_hash TEXT NOT NULL,
               mode TEXT NOT NULL, chunk_kib INTEGER NOT NULL,
               auto_lock_secs INTEGER NOT NULL, lock_on_hide INTEGER NOT NULL,
               equal_hold_enabled INTEGER NOT NULL DEFAULT 1,
               recovery_question TEXT, recovery_answer_hash TEXT,
               theme TEXT NOT NULL DEFAULT 'forest',
               vault_key_salt BLOB, vault_key_nonce BLOB, wrapped_vault_key BLOB,
               recovery_key_salt BLOB, recovery_key_nonce BLOB, recovery_wrapped_vault_key BLOB,
               mask_file_names INTEGER NOT NULL DEFAULT 0,
               accent_color TEXT NOT NULL DEFAULT '#9be8c4',
               secure_delete INTEGER NOT NULL DEFAULT 1
             );
             CREATE TABLE IF NOT EXISTS files (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL,
               added_at INTEGER NOT NULL, data BLOB NOT NULL
             );
             PRAGMA user_version = 3;",
        )
        .map_err(db_error)?;
        ensure_column(&db, "equal_hold_enabled", "INTEGER NOT NULL DEFAULT 1")?;
        ensure_column(&db, "recovery_question", "TEXT")?;
        ensure_column(&db, "recovery_answer_hash", "TEXT")?;
        ensure_column(&db, "theme", "TEXT NOT NULL DEFAULT 'forest'")?;
        ensure_column(&db, "vault_key_salt", "BLOB")?;
        ensure_column(&db, "vault_key_nonce", "BLOB")?;
        ensure_column(&db, "wrapped_vault_key", "BLOB")?;
        ensure_column(&db, "recovery_key_salt", "BLOB")?;
        ensure_column(&db, "recovery_key_nonce", "BLOB")?;
        ensure_column(&db, "recovery_wrapped_vault_key", "BLOB")?;
        ensure_column(&db, "mask_file_names", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_column(&db, "accent_color", "TEXT NOT NULL DEFAULT '#9be8c4'")?;
        ensure_column(&db, "secure_delete", "INTEGER NOT NULL DEFAULT 1")?;
        Ok(Self {
            db: Mutex::new(db),
            session: Mutex::new(None),
            epoch: AtomicU64::new(0),
            attempts: Mutex::new(Attempts::default()),
            auth: Mutex::new(()),
        })
    }

    #[cfg(test)]
    pub fn configured(&self) -> Result<bool> {
        guard(&self.db)?
            .query_row("SELECT EXISTS(SELECT 1 FROM config)", [], |r| r.get(0))
            .map_err(db_error)
    }

    pub fn status(&self) -> Result<VaultStatus> {
        let db = guard(&self.db)?;
        let row = db
            .query_row(
                "SELECT equal_hold_enabled, recovery_question, theme FROM config WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?)),
            )
            .optional()
            .map_err(db_error)?;
        Ok(match row {
            Some((equal_hold_enabled, recovery_question, theme)) => VaultStatus {
                configured: true,
                equal_hold_enabled,
                recovery_question,
                theme: Theme::parse(&theme)?,
            },
            None => VaultStatus {
                configured: false,
                equal_hold_enabled: true,
                recovery_question: None,
                theme: Theme::Forest,
            },
        })
    }

    pub fn lock(&self) -> Result<()> {
        let mut session = guard(&self.session)?;
        self.epoch.fetch_add(1, Ordering::SeqCst);
        *session = None;
        Ok(())
    }

    fn authorize(&self, token: &str) -> Result<()> {
        let mut session = guard(&self.session)?;
        match session.as_mut() {
            Some(active) if active.last_activity.elapsed() >= active.timeout => {
                *session = None;
                Err(LOCKED.into())
            }
            Some(active) if active.token == token => {
                active.last_activity = Instant::now();
                Ok(())
            }
            _ => Err(LOCKED.into()),
        }
    }

    fn session_key(&self, token: &str) -> Result<Zeroizing<[u8; 32]>> {
        let mut session = guard(&self.session)?;
        match session.as_mut() {
            Some(active) if active.last_activity.elapsed() >= active.timeout => {
                *session = None;
                Err(LOCKED.into())
            }
            Some(active) if active.token == token => {
                active.last_activity = Instant::now();
                Ok(active.key.clone())
            }
            _ => Err(LOCKED.into()),
        }
    }

    fn load_or_migrate_key(
        &self,
        password: &str,
        mode: ProtectionMode,
    ) -> Result<Zeroizing<[u8; 32]>> {
        let wrapped = guard(&self.db)?
            .query_row(
                "SELECT vault_key_salt, vault_key_nonce, wrapped_vault_key FROM config WHERE id = 1",
                [],
                |r| Ok((r.get::<_, Option<Vec<u8>>>(0)?, r.get::<_, Option<Vec<u8>>>(1)?, r.get::<_, Option<Vec<u8>>>(2)?)),
            )
            .map_err(db_error)?;
        if let (Some(salt), Some(nonce), Some(data)) = wrapped {
            return unwrap_key(&WrappedKey { salt, nonce, data }, password, mode);
        }

        let mut key = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(key.as_mut());
        let wrapped = wrap_key(&key, password, mode)?;
        let mut db = guard(&self.db)?;
        let tx = db.transaction().map_err(db_error)?;
        {
            let mut query = tx
                .prepare("SELECT id, name, data FROM files")
                .map_err(db_error)?;
            let rows = query
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Vec<u8>>(2)?,
                    ))
                })
                .map_err(db_error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(db_error)?;
            drop(query);
            for (id, name, data) in rows {
                let encrypted_name = encrypt_name(&key, &id, &name)?;
                let encrypted_data = encrypt_data(&key, &id, &data)?;
                tx.execute(
                    "UPDATE files SET name = ?1, data = ?2 WHERE id = ?3",
                    params![encrypted_name, encrypted_data, id],
                )
                .map_err(db_error)?;
            }
        }
        tx.execute(
            "UPDATE config SET vault_key_salt = ?1, vault_key_nonce = ?2, wrapped_vault_key = ?3 WHERE id = 1",
            params![wrapped.salt, wrapped.nonce, wrapped.data],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(key)
    }

    fn start_session(
        &self,
        epoch: u64,
        settings: &Settings,
        key: Zeroizing<[u8; 32]>,
    ) -> Result<String> {
        let mut session = guard(&self.session)?;
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return Err(LOCKED.into());
        }
        let token = Uuid::new_v4().to_string();
        *session = Some(Session {
            token: token.clone(),
            last_activity: Instant::now(),
            timeout: Duration::from_secs(settings.auto_lock_secs.into()),
            key,
        });
        Ok(token)
    }

    pub fn authentication_epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }

    pub fn revoke_session(&self, token: &str) -> Result<()> {
        let mut session = guard(&self.session)?;
        if session.as_ref().is_some_and(|active| active.token == token) {
            *session = None;
        }
        Ok(())
    }

    #[cfg(test)]
    fn create(&self, password: String) -> Result<Login> {
        self.create_at_epoch(password, self.authentication_epoch())
    }

    pub fn create_at_epoch(&self, password: String, epoch: u64) -> Result<Login> {
        let password = Zeroizing::new(password);
        let _auth = guard(&self.auth)?;
        if self.authentication_epoch() != epoch {
            return Err(LOCKED.into());
        }
        validate_password(&password)?;
        let settings = Settings::default();
        let hash = hash_password(&password, settings.mode)?;
        let mut key = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(key.as_mut());
        let wrapped = wrap_key(&key, &password, settings.mode)?;
        let db = guard(&self.db)?;
        if db
            .query_row("SELECT EXISTS(SELECT 1 FROM config)", [], |r| {
                r.get::<_, bool>(0)
            })
            .map_err(db_error)?
        {
            return Err("Хранилище уже создано.".into());
        }
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return Err(LOCKED.into());
        }
        db.execute(
            "INSERT INTO config (id, password_hash, mode, chunk_kib, auto_lock_secs, lock_on_hide, equal_hold_enabled, theme, vault_key_salt, vault_key_nonce, wrapped_vault_key) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                hash,
                settings.mode.as_str(),
                settings.chunk_kib,
                settings.auto_lock_secs,
                settings.lock_on_hide,
                settings.equal_hold_enabled,
                settings.theme.as_str(),
                wrapped.salt,
                wrapped.nonce,
                wrapped.data,
            ],
        )
        .map_err(db_error)?;
        drop(db);
        let token = self.start_session(epoch, &settings, key)?;
        Ok(Login {
            snapshot: self.snapshot(&token)?,
            token,
        })
    }

    #[cfg(test)]
    fn unlock(&self, password: String) -> Result<Login> {
        self.unlock_at_epoch(password, self.authentication_epoch())
    }

    pub fn unlock_at_epoch(&self, password: String, epoch: u64) -> Result<Login> {
        let password = Zeroizing::new(password);
        let _auth = guard(&self.auth)?;
        if self.authentication_epoch() != epoch {
            return Err(LOCKED.into());
        }
        self.check_attempts()?;
        let (hash, settings) = self.config()?;
        self.verify(&password, &hash)?;
        let key = self.load_or_migrate_key(&password, settings.mode)?;
        let token = self.start_session(epoch, &settings, key)?;
        Ok(Login {
            snapshot: self.snapshot(&token)?,
            token,
        })
    }

    pub fn recovery_question(&self) -> Result<Option<String>> {
        guard(&self.db)?
            .query_row(
                "SELECT recovery_question FROM config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)
            .map(|value| value.flatten())
    }

    pub fn recover_at_epoch(
        &self,
        answer: String,
        new_password: String,
        epoch: u64,
    ) -> Result<Login> {
        let answer = Zeroizing::new(normalize_answer(&answer));
        let new_password = Zeroizing::new(new_password);
        let _auth = guard(&self.auth)?;
        if self.authentication_epoch() != epoch {
            return Err(LOCKED.into());
        }
        self.check_attempts()?;
        validate_password(&new_password)?;
        let (answer_hash, settings, recovery_wrapped) = self.recovery_config()?;
        self.verify_secret(&answer, &answer_hash, "Неверный ответ.")?;
        let key = unwrap_key(&recovery_wrapped, &answer, settings.mode)?;
        let password_hash = hash_password(&new_password, settings.mode)?;
        let password_wrapped = wrap_key(&key, &new_password, settings.mode)?;
        if self.authentication_epoch() != epoch {
            return Err(LOCKED.into());
        }
        guard(&self.db)?
            .execute(
                "UPDATE config SET password_hash = ?1, vault_key_salt = ?2, vault_key_nonce = ?3, wrapped_vault_key = ?4 WHERE id = 1",
                params![password_hash, password_wrapped.salt, password_wrapped.nonce, password_wrapped.data],
            )
            .map_err(db_error)?;
        let token = self.start_session(epoch, &settings, key)?;
        Ok(Login {
            snapshot: self.snapshot(&token)?,
            token,
        })
    }

    fn check_attempts(&self) -> Result<()> {
        if let Some(at) = guard(&self.attempts)?.retry_at {
            if at > Instant::now() {
                return Err(format!(
                    "Повторите через {} сек.",
                    at.duration_since(Instant::now()).as_secs() + 1
                ));
            }
        }
        Ok(())
    }

    fn verify(&self, password: &str, hash: &str) -> Result<()> {
        self.verify_secret(password, hash, "Неверный пароль.")
    }

    fn verify_secret(&self, secret: &str, hash: &str, error: &str) -> Result<()> {
        let parsed = PasswordHash::new(hash).map_err(|_| "Повреждена запись пароля.")?;
        let valid = secret.len() <= 1024
            && Argon2::default()
                .verify_password(secret.as_bytes(), &parsed)
                .is_ok();
        let mut attempts = guard(&self.attempts)?;
        if !valid {
            attempts.failures = attempts.failures.saturating_add(1);
            if attempts.failures >= 3 {
                let delay = 2u64.pow((attempts.failures - 3).min(5));
                attempts.retry_at = Some(Instant::now() + Duration::from_secs(delay));
            }
            return Err(error.into());
        }
        *attempts = Attempts::default();
        Ok(())
    }

    fn config(&self) -> Result<(String, Settings)> {
        let db = guard(&self.db)?;
        let row = db.query_row(
            "SELECT password_hash, mode, chunk_kib, auto_lock_secs, lock_on_hide, equal_hold_enabled, recovery_question, theme, mask_file_names, accent_color, secure_delete FROM config WHERE id = 1",
            [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get::<_, String>(7)?, r.get(8)?, r.get(9)?, r.get(10)?))
        ).optional().map_err(db_error)?.ok_or("Сначала создайте хранилище.")?;
        Ok((
            row.0,
            Settings {
                mode: ProtectionMode::parse(&row.1)?,
                chunk_kib: row.2,
                auto_lock_secs: row.3,
                lock_on_hide: row.4,
                equal_hold_enabled: row.5,
                recovery_question: row.6,
                theme: Theme::parse(&row.7)?,
                mask_file_names: row.8,
                accent_color: row.9,
                secure_delete: row.10,
            },
        ))
    }

    fn recovery_config(&self) -> Result<(String, Settings, WrappedKey)> {
        let settings = self.config()?.1;
        let row = guard(&self.db)?
            .query_row(
                "SELECT recovery_answer_hash, recovery_key_salt, recovery_key_nonce, recovery_wrapped_vault_key FROM config WHERE id = 1",
                [],
                |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<Vec<u8>>>(1)?, r.get::<_, Option<Vec<u8>>>(2)?, r.get::<_, Option<Vec<u8>>>(3)?)),
            )
            .map_err(db_error)?;
        match row {
            (Some(hash), Some(salt), Some(nonce), Some(data)) => {
                Ok((hash, settings, WrappedKey { salt, nonce, data }))
            }
            _ => Err("Восстановление пароля не настроено.".into()),
        }
    }

    pub fn snapshot(&self, token: &str) -> Result<Snapshot> {
        let key = self.session_key(token)?;
        let settings = self.config()?.1;
        let db = guard(&self.db)?;
        let mut statement = db
            .prepare("SELECT id, name, size, added_at FROM files ORDER BY added_at DESC, id")
            .map_err(db_error)?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u64>(2)?,
                    r.get::<_, u64>(3)?,
                ))
            })
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)?;
        let files = rows
            .into_iter()
            .map(|(id, name, size, added_at)| {
                Ok(VaultFile {
                    name: decrypt_name(&key, &id, &name)?,
                    id,
                    size,
                    added_at,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        self.authorize(token)?;
        Ok(Snapshot { files, settings })
    }

    pub fn import(&self, token: &str, name: String, data: &[u8]) -> Result<VaultFile> {
        let key = self.session_key(token)?;
        let name = validate_name(&name)?;
        if data.len() > MAX_FILE_SIZE {
            return Err("Один файл может занимать до 32 МиБ.".into());
        }
        let db = guard(&self.db)?;
        let existing_id = {
            let mut query = db.prepare("SELECT id, name FROM files").map_err(db_error)?;
            let rows = query
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(db_error)?;
            let mut found = None;
            for row in rows {
                let (id, encrypted_name) = row.map_err(db_error)?;
                if decrypt_name(&key, &id, &encrypted_name).ok().as_deref() == Some(name.as_str()) {
                    found = Some(id);
                    break;
                }
            }
            found
        };
        let file = VaultFile {
            id: existing_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            name,
            size: data.len() as u64,
            added_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Ошибка системных часов.")?
                .as_millis() as u64,
        };
        let encrypted_name = encrypt_name(&key, &file.id, &file.name)?;
        let encrypted_data = encrypt_data(&key, &file.id, data)?;
        self.authorize(token)?;
        if existing_id.is_some() {
            db.execute(
                "UPDATE files SET name=?1, size=?2, added_at=?3, data=?4 WHERE id=?5",
                params![
                    encrypted_name,
                    file.size,
                    file.added_at,
                    encrypted_data,
                    file.id
                ],
            )
            .map_err(db_error)?;
        } else {
            db.execute(
                "INSERT INTO files VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    file.id,
                    encrypted_name,
                    file.size,
                    file.added_at,
                    encrypted_data
                ],
            )
            .map_err(db_error)?;
        }
        Ok(file)
    }

    pub fn read(&self, token: &str, id: &str) -> Result<Vec<u8>> {
        let key = self.session_key(token)?;
        let data: Vec<u8> = guard(&self.db)?
            .query_row("SELECT data FROM files WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(db_error)?
            .ok_or("Файл не найден.")?;
        self.authorize(token)?;
        decrypt_data(&key, id, &data)
    }

    pub fn rename(&self, token: &str, id: &str, name: &str) -> Result<()> {
        let name = validate_name(name)?;
        let key = self.session_key(token)?;
        let encrypted_name = encrypt_name(&key, id, &name)?;
        let db = guard(&self.db)?;
        self.authorize(token)?;
        if db
            .execute(
                "UPDATE files SET name = ?1 WHERE id = ?2",
                params![encrypted_name, id],
            )
            .map_err(db_error)?
            == 0
        {
            return Err("Файл не найден.".into());
        }
        Ok(())
    }

    pub fn delete(&self, token: &str, id: &str) -> Result<()> {
        let secure_delete = self.config()?.1.secure_delete;
        let db = guard(&self.db)?;
        self.authorize(token)?;
        db.pragma_update(None, "secure_delete", secure_delete)
            .map_err(db_error)?;
        let deleted = db
            .execute("DELETE FROM files WHERE id = ?1", [id])
            .map_err(db_error)?;
        db.pragma_update(None, "secure_delete", true)
            .map_err(db_error)?;
        if deleted == 0 {
            return Err("Файл не найден.".into());
        }
        Ok(())
    }

    pub fn save_settings(
        &self,
        token: &str,
        settings: Settings,
        password: String,
        new_password: Option<String>,
        recovery_answer: Option<String>,
    ) -> Result<()> {
        let password = Zeroizing::new(password);
        let new_password = new_password.map(Zeroizing::new);
        let recovery_answer = recovery_answer.map(|value| Zeroizing::new(normalize_answer(&value)));
        let key = self.session_key(token)?;
        settings.validate()?;
        let _auth = guard(&self.auth)?;
        self.check_attempts()?;
        let (old_hash, old_settings) = self.config()?;
        self.verify(&password, &old_hash)?;
        let chosen = new_password.as_deref().unwrap_or(&password);
        validate_password(chosen)?;
        let hash = hash_password(chosen, settings.mode)?;
        let password_wrapped = wrap_key(&key, chosen, settings.mode)?;
        let question = settings
            .recovery_question
            .as_deref()
            .map(validate_question)
            .transpose()?;
        let old_recovery = guard(&self.db)?
            .query_row(
                "SELECT recovery_question, recovery_answer_hash, recovery_key_salt, recovery_key_nonce, recovery_wrapped_vault_key FROM config WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<Vec<u8>>>(2)?,
                        r.get::<_, Option<Vec<u8>>>(3)?,
                        r.get::<_, Option<Vec<u8>>>(4)?,
                    ))
                },
            )
            .map_err(db_error)?;
        let (answer_hash, recovery_wrapped) =
            match (question.as_deref(), recovery_answer.as_deref()) {
                (None, _) => (None, None),
                (Some(_), Some(answer)) => {
                    validate_answer(answer)?;
                    (
                        Some(hash_password(answer, settings.mode)?),
                        Some(wrap_key(&key, answer, settings.mode)?),
                    )
                }
                (Some(current), None)
                    if old_recovery.0.as_deref() == Some(current)
                        && old_settings.mode == settings.mode =>
                {
                    let wrapped = match (old_recovery.2, old_recovery.3, old_recovery.4) {
                        (Some(salt), Some(nonce), Some(data)) => {
                            Some(WrappedKey { salt, nonce, data })
                        }
                        _ => return Err("Введите ответ заново для обновления защиты.".into()),
                    };
                    (old_recovery.1, wrapped)
                }
                (Some(_), None) => return Err("Введите ответ для контрольного вопроса.".into()),
            };
        let (recovery_salt, recovery_nonce, recovery_data) = match recovery_wrapped {
            Some(wrapped) => (Some(wrapped.salt), Some(wrapped.nonce), Some(wrapped.data)),
            None => (None, None, None),
        };
        let db = guard(&self.db)?;
        self.authorize(token)?;
        db.execute("UPDATE config SET password_hash = ?1, mode = ?2, chunk_kib = ?3, auto_lock_secs = ?4, lock_on_hide = ?5, equal_hold_enabled = ?6, recovery_question = ?7, recovery_answer_hash = ?8, theme = ?9, vault_key_salt = ?10, vault_key_nonce = ?11, wrapped_vault_key = ?12, recovery_key_salt = ?13, recovery_key_nonce = ?14, recovery_wrapped_vault_key = ?15, mask_file_names = ?16, accent_color = ?17, secure_delete = ?18 WHERE id = 1",
            params![hash, settings.mode.as_str(), settings.chunk_kib, settings.auto_lock_secs, settings.lock_on_hide, settings.equal_hold_enabled, question, answer_hash, settings.theme.as_str(), password_wrapped.salt, password_wrapped.nonce, password_wrapped.data, recovery_salt, recovery_nonce, recovery_data, settings.mask_file_names, settings.accent_color, settings.secure_delete]).map_err(db_error)?;
        if let Some(session) = guard(&self.session)?.as_mut() {
            session.timeout = Duration::from_secs(settings.auto_lock_secs.into());
        }
        Ok(())
    }

    pub fn touch(&self, token: &str) -> Result<()> {
        self.authorize(token)
    }
}

fn ensure_column(db: &Connection, name: &str, definition: &str) -> Result<()> {
    let mut statement = db.prepare("PRAGMA table_info(config)").map_err(db_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if !columns.iter().any(|column| column == name) {
        db.execute(
            &format!("ALTER TABLE config ADD COLUMN {name} {definition}"),
            [],
        )
        .map_err(db_error)?;
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<()> {
    if password.chars().count() < 8 || password.len() > 1024 {
        return Err("Пароль: минимум 8 символов, максимум 1024 байта.".into());
    }
    Ok(())
}

fn hash_password(password: &str, mode: ProtectionMode) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, mode.params())
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Не удалось обработать пароль.".into())
}

fn derive_key(secret: &str, salt: &[u8], mode: ProtectionMode) -> Result<Zeroizing<[u8; 32]>> {
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, mode.params())
        .hash_password_into(secret.as_bytes(), salt, key.as_mut())
        .map_err(|_| "Не удалось получить ключ шифрования.".to_string())?;
    Ok(key)
}

fn wrap_key(key: &[u8; 32], secret: &str, mode: ProtectionMode) -> Result<WrappedKey> {
    let mut salt = vec![0u8; 16];
    let mut nonce = vec![0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let wrapping_key = derive_key(secret, &salt, mode)?;
    let data = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
        .map_err(|_| "Ошибка ключа шифрования.".to_string())?
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: key,
                aad: b"vault-key-v1",
            },
        )
        .map_err(|_| "Не удалось защитить ключ хранилища.".to_string())?;
    Ok(WrappedKey { salt, nonce, data })
}

fn unwrap_key(
    wrapped: &WrappedKey,
    secret: &str,
    mode: ProtectionMode,
) -> Result<Zeroizing<[u8; 32]>> {
    if wrapped.salt.len() != 16 || wrapped.nonce.len() != 24 {
        return Err("Повреждён контейнер ключа.".into());
    }
    let wrapping_key = derive_key(secret, &wrapped.salt, mode)?;
    let plain = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
        .map_err(|_| "Ошибка ключа шифрования.".to_string())?
        .decrypt(
            XNonce::from_slice(&wrapped.nonce),
            Payload {
                msg: &wrapped.data,
                aad: b"vault-key-v1",
            },
        )
        .map_err(|_| "Не удалось открыть ключ хранилища.".to_string())?;
    plain
        .try_into()
        .map(Zeroizing::new)
        .map_err(|_| "Повреждён контейнер ключа.".into())
}

fn encrypt(key: &[u8; 32], plain: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| "Ошибка ключа шифрования.".to_string())?;
    let encrypted = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plain, aad })
        .map_err(|_| "Не удалось зашифровать данные.".to_string())?;
    let mut container = Vec::with_capacity(24 + encrypted.len());
    container.extend_from_slice(&nonce);
    container.extend_from_slice(&encrypted);
    Ok(container)
}

fn decrypt(key: &[u8; 32], container: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    if container.len() < 40 {
        return Err("Повреждён зашифрованный контейнер.".into());
    }
    XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| "Ошибка ключа шифрования.".to_string())?
        .decrypt(
            XNonce::from_slice(&container[..24]),
            Payload {
                msg: &container[24..],
                aad,
            },
        )
        .map_err(|_| "Контейнер повреждён или подменён.".into())
}

fn encrypt_name(key: &[u8; 32], id: &str, name: &str) -> Result<String> {
    Ok(format!(
        "{ENCRYPTED_NAME}{}",
        STANDARD_NO_PAD.encode(encrypt(
            key,
            name.as_bytes(),
            format!("name:{id}").as_bytes()
        )?)
    ))
}

fn decrypt_name(key: &[u8; 32], id: &str, name: &str) -> Result<String> {
    let encoded = name
        .strip_prefix(ENCRYPTED_NAME)
        .ok_or("Обнаружено незашифрованное имя файла.")?;
    let container = STANDARD_NO_PAD
        .decode(encoded)
        .map_err(|_| "Повреждено имя файла.".to_string())?;
    String::from_utf8(decrypt(key, &container, format!("name:{id}").as_bytes())?)
        .map_err(|_| "Повреждено имя файла.".into())
}

fn encrypt_data(key: &[u8; 32], id: &str, data: &[u8]) -> Result<Vec<u8>> {
    let encrypted = encrypt(key, data, format!("data:{id}").as_bytes())?;
    let mut container = Vec::with_capacity(4 + encrypted.len());
    container.extend_from_slice(ENCRYPTED_DATA);
    container.extend_from_slice(&encrypted);
    Ok(container)
}

fn decrypt_data(key: &[u8; 32], id: &str, data: &[u8]) -> Result<Vec<u8>> {
    let encrypted = data
        .strip_prefix(ENCRYPTED_DATA)
        .ok_or("Обнаружены незашифрованные данные файла.")?;
    decrypt(key, encrypted, format!("data:{id}").as_bytes())
}

fn normalize_answer(answer: &str) -> String {
    answer.trim().to_lowercase()
}

fn validate_question(question: &str) -> Result<String> {
    let question = question.trim();
    if question.chars().count() < 3 || question.chars().count() > 200 {
        return Err("Контрольный вопрос: от 3 до 200 символов.".into());
    }
    Ok(question.to_owned())
}

fn validate_answer(answer: &str) -> Result<()> {
    if answer.chars().count() < 3 || answer.len() > 1024 {
        return Err("Ответ: минимум 3 символа, максимум 1024 байта.".into());
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > 200
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || name.ends_with('.')
    {
        return Err("Имя: 1–200 символов, без служебных символов и точки в конце.".into());
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistent_round_trip_and_session_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.db");
        let store = Store::open(&path).unwrap();
        assert!(!store.configured().unwrap());
        assert!(store.create("short".into()).is_err());
        let login = store.create("correct horse battery".into()).unwrap();
        assert!(store.create("another password".into()).is_err());
        assert!(store.import("forged", "test.txt".into(), b"test").is_err());
        let file = store
            .import(&login.token, "photo.png".into(), &[0, 1, 255, 0, 10])
            .unwrap();
        let empty = store.import(&login.token, "empty.txt".into(), &[]).unwrap();
        let replaced = store
            .import(&login.token, "photo.png".into(), b"new")
            .unwrap();
        assert_eq!(replaced.id, file.id);
        assert_eq!(store.read(&login.token, &file.id).unwrap(), b"new");
        let stored: (String, Vec<u8>) = store
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT name, data FROM files WHERE id = ?1",
                [&file.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(stored.0.starts_with(ENCRYPTED_NAME));
        assert_ne!(stored.0, "photo.png");
        assert!(stored.1.starts_with(ENCRYPTED_DATA));
        assert!(!stored.1.windows(5).any(|bytes| bytes == [0, 1, 255, 0, 10]));
        assert!(store
            .import(&login.token, "../escape".into(), b"bad")
            .is_err());
        store.rename(&login.token, &file.id, "renamed.png").unwrap();
        store.lock().unwrap();
        assert!(store.snapshot(&login.token).is_err());
        assert!(store.read(&login.token, &file.id).is_err());
        assert!(store.delete(&login.token, &file.id).is_err());
        assert!(store.unlock("incorrect".into()).is_err());
        drop(store);

        let store = Store::open(&path).unwrap();
        assert!(store.read(&login.token, &file.id).is_err());
        let login = store.unlock("correct horse battery".into()).unwrap();
        assert_eq!(login.snapshot.files.len(), 2);
        assert_eq!(store.read(&login.token, &file.id).unwrap(), b"new");
        assert!(store.read(&login.token, &empty.id).unwrap().is_empty());
        assert!(login.snapshot.files.iter().any(|f| f.name == "renamed.png"));
        store.delete(&login.token, &file.id).unwrap();
        assert!(store.read(&login.token, &file.id).is_err());
    }

    #[test]
    fn legacy_database_is_encrypted_on_first_unlock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE config (id INTEGER PRIMARY KEY, password_hash TEXT NOT NULL, mode TEXT NOT NULL, chunk_kib INTEGER NOT NULL, auto_lock_secs INTEGER NOT NULL, lock_on_hide INTEGER NOT NULL);
             CREATE TABLE files (id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, added_at INTEGER NOT NULL, data BLOB NOT NULL);",
        )
        .unwrap();
        let hash = hash_password("legacy password", ProtectionMode::Fast).unwrap();
        db.execute(
            "INSERT INTO config VALUES (1, ?1, 'fast', 512, 300, 1)",
            [hash],
        )
        .unwrap();
        db.execute(
            "INSERT INTO files VALUES ('legacy-id', 'secret.txt', 6, 1, ?1)",
            [b"secret".as_slice()],
        )
        .unwrap();
        drop(db);

        let store = Store::open(&path).unwrap();
        let login = store.unlock("legacy password".into()).unwrap();
        assert_eq!(login.snapshot.files[0].name, "secret.txt");
        assert_eq!(store.read(&login.token, "legacy-id").unwrap(), b"secret");
        let stored: (String, Vec<u8>) = store
            .db
            .lock()
            .unwrap()
            .query_row("SELECT name, data FROM files", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert!(stored.0.starts_with(ENCRYPTED_NAME));
        assert!(stored.1.starts_with(ENCRYPTED_DATA));
    }

    #[test]
    fn settings_rehash_password_and_timeout_revokes_session() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let login = store.create("old password".into()).unwrap();
        let settings = Settings {
            mode: ProtectionMode::Fast,
            chunk_kib: 1024,
            auto_lock_secs: 60,
            lock_on_hide: false,
            equal_hold_enabled: false,
            recovery_question: Some("Первый питомец?".into()),
            theme: Theme::Midnight,
            mask_file_names: true,
            accent_color: "#abcdef".into(),
            secure_delete: true,
        };
        assert!(store
            .save_settings(&login.token, settings.clone(), "wrong".into(), None, None)
            .is_err());
        store
            .save_settings(
                &login.token,
                settings,
                "old password".into(),
                Some("new password".into()),
                Some(" Барсик ".into()),
            )
            .unwrap();
        let (hash, _) = store.config().unwrap();
        assert!(hash.starts_with("$argon2id$v=19$m=16384,t=2,p=1$"));
        store.lock().unwrap();
        assert!(store.unlock("old password".into()).is_err());
        let login = store.unlock("new password".into()).unwrap();
        assert_eq!(login.snapshot.settings.chunk_kib, 1024);
        assert!(!login.snapshot.settings.equal_hold_enabled);
        store.lock().unwrap();
        assert!(store
            .recover_at_epoch(
                "ошибка".into(),
                "reset password".into(),
                store.authentication_epoch()
            )
            .is_err());
        let login = store
            .recover_at_epoch(
                "барсик".into(),
                "reset password".into(),
                store.authentication_epoch(),
            )
            .unwrap();
        assert!(store.snapshot(&login.token).is_ok());
        store.lock().unwrap();
        assert!(store.unlock("new password".into()).is_err());
        let login = store.unlock("reset password".into()).unwrap();
        store
            .session
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .last_activity = Instant::now() - Duration::from_secs(61);
        assert!(store.touch(&login.token).is_err());
    }

    #[test]
    fn emergency_lock_cancels_inflight_authentication() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let epoch = store.epoch.load(Ordering::SeqCst);
        store.lock().unwrap();
        assert!(store
            .start_session(epoch, &Settings::default(), Zeroizing::new([0u8; 32]))
            .is_err());
        assert!(store
            .create_at_epoch("long password".into(), epoch)
            .is_err());
        assert!(!store.configured().unwrap());
        assert!(store.snapshot("anything").is_err());
        let login = store.create("long password".into()).unwrap();
        store.revoke_session("stale token").unwrap();
        assert!(store.snapshot(&login.token).is_ok());
        store.revoke_session(&login.token).unwrap();
        assert!(store.snapshot(&login.token).is_err());
    }
}
