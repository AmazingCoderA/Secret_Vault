use crate::store::{Login, Result, Settings, Snapshot, Store, VaultFile};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;
use rand_core::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::Duration,
};
use uuid::Uuid;
use zeroize::Zeroize;

#[derive(Clone, Serialize)]
pub struct ContainerSummary {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct ManagerStatus {
    pub containers: Vec<ContainerSummary>,
}

struct Record {
    id: String,
    path: String,
}

struct PendingDelete {
    id: String,
    original: PathBuf,
    trash: PathBuf,
    name: Option<String>,
    hidden_hash: Option<String>,
    mode: String,
    created_at: i64,
    passes: u8,
}

pub struct Manager {
    root: PathBuf,
    index: Mutex<Connection>,
    stores: Mutex<HashMap<String, Arc<Store>>>,
    sessions: Mutex<HashMap<String, String>>,
    pending: Arc<Mutex<HashMap<String, PendingDelete>>>,
}

fn guard<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| "Внутренняя ошибка. Перезапустите приложение.".into())
}

fn db_error(error: rusqlite::Error) -> String {
    format!("Ошибка индекса контейнеров: {error}")
}

fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err("Имя контейнера: от 1 до 100 печатных символов.".into());
    }
    Ok(name.to_owned())
}

impl Manager {
    pub fn open(root: &Path) -> Result<Self> {
        clean_temp_files();
        let index = Connection::open(root.join("containers.sqlite3")).map_err(db_error)?;
        index
            .execute_batch(
                "PRAGMA secure_delete=ON;
                 CREATE TABLE IF NOT EXISTS containers (
                   id TEXT PRIMARY KEY, public_name TEXT UNIQUE, hidden_name_hash TEXT,
                   path TEXT NOT NULL UNIQUE, access_mode TEXT NOT NULL, created_at INTEGER NOT NULL
                 );
                 PRAGMA user_version=1;",
            )
            .map_err(db_error)?;

        let legacy = root.join("vault-prototype.sqlite3");
        let empty: bool = index
            .query_row("SELECT NOT EXISTS(SELECT 1 FROM containers)", [], |row| {
                row.get(0)
            })
            .map_err(db_error)?;
        if empty && legacy.exists() && Store::open(&legacy)?.status()?.configured {
            index
                .execute(
                    "INSERT INTO containers VALUES (?1, 'Основной', NULL, ?2, 'legacy', 0)",
                    params![
                        Uuid::new_v4().to_string(),
                        legacy.file_name().unwrap().to_string_lossy()
                    ],
                )
                .map_err(db_error)?;
        }

        Ok(Self {
            root: root.to_owned(),
            index: Mutex::new(index),
            stores: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            pending: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn status(&self) -> Result<ManagerStatus> {
        let index = guard(&self.index)?;
        let mut query = index
            .prepare(
                "SELECT id, public_name FROM containers
                 WHERE public_name IS NOT NULL ORDER BY created_at, public_name",
            )
            .map_err(db_error)?;
        let containers = query
            .query_map([], |row| {
                Ok(ContainerSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            })
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)?;
        Ok(ManagerStatus { containers })
    }

    fn record(&self, id: Option<&str>, name: Option<&str>) -> Result<Record> {
        let index = guard(&self.index)?;
        if let Some(id) = id {
            return index
                .query_row(
                    "SELECT id, path, access_mode FROM containers
                     WHERE id=?1 AND public_name IS NOT NULL",
                    [id],
                    |row| {
                        Ok(Record {
                            id: row.get(0)?,
                            path: row.get(1)?,
                        })
                    },
                )
                .optional()
                .map_err(db_error)?
                .ok_or("Контейнер не найден.".into());
        }

        let name = validate_name(name.unwrap_or(""))?;
        let mut query = index
            .prepare(
                "SELECT id, path, hidden_name_hash FROM containers
                 WHERE public_name IS NULL",
            )
            .map_err(db_error)?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(db_error)?;
        for row in rows {
            let (id, path, hash) = row.map_err(db_error)?;
            if PasswordHash::new(&hash).ok().is_some_and(|parsed| {
                Argon2::default()
                    .verify_password(name.as_bytes(), &parsed)
                    .is_ok()
            }) {
                return Ok(Record { id, path });
            }
        }
        Err("Контейнер не найден или неверные данные доступа.".into())
    }

    fn store(&self, record: &Record) -> Result<Arc<Store>> {
        let mut stores = guard(&self.stores)?;
        if let Some(store) = stores.get(&record.id) {
            return Ok(store.clone());
        }
        let stored_path = Path::new(&record.path);
        let path = if stored_path.is_absolute() {
            stored_path.to_path_buf()
        } else {
            self.root.join(stored_path)
        };
        let store = Arc::new(Store::open(&path)?);
        stores.insert(record.id.clone(), store.clone());
        Ok(store)
    }

    fn resolve_path(&self, path: &str) -> PathBuf {
        let path = Path::new(path);
        if path.is_absolute() {
            path.to_owned()
        } else {
            self.root.join(path)
        }
    }

    pub fn create(
        &self,
        name: String,
        hidden: bool,
        password: String,
        location: Option<String>,
    ) -> Result<Login> {
        let name = validate_name(&name)?;
        let id = Uuid::new_v4().to_string();
        let path = location
            .map(PathBuf::from)
            .unwrap_or_else(|| self.root.join(format!("container-{id}.sqlite3")));
        let hidden_hash = if hidden {
            Some(
                Argon2::default()
                    .hash_password(name.as_bytes(), &SaltString::generate(&mut OsRng))
                    .map_err(|_| "Не удалось защитить имя контейнера.")?
                    .to_string(),
            )
        } else {
            None
        };
        let store = Arc::new(Store::open(&path)?);
        let login = match store.create_at_epoch(password, store.authentication_epoch()) {
            Ok(login) => login,
            Err(error) => {
                let _ = fs::remove_file(&path);
                return Err(error);
            }
        };
        let inserted = guard(&self.index)?
            .execute(
                "INSERT INTO containers VALUES (?1, ?2, ?3, ?4, 'password', strftime('%s','now'))",
                params![
                    id,
                    if hidden { None } else { Some(name) },
                    hidden_hash,
                    path.to_string_lossy().to_string()
                ],
            )
            .map_err(|error| {
                if error.to_string().contains("UNIQUE") {
                    "Контейнер с таким видимым именем уже существует.".into()
                } else {
                    db_error(error)
                }
            });
        if let Err(error) = inserted {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        guard(&self.stores)?.insert(id.clone(), store);
        guard(&self.sessions)?.insert(login.token.clone(), id);
        Ok(login)
    }

    pub fn delete(&self, id: String, passes: u8) -> Result<()> {
        if ![0, 3].contains(&passes) {
            return Err("Допустимо 0 или 3 прохода очистки.".into());
        }
        let (path, name, hidden_hash, mode, created_at): (String, Option<String>, Option<String>, String, i64) = guard(&self.index)?.query_row("SELECT path, public_name, hidden_name_hash, access_mode, created_at FROM containers WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional().map_err(db_error)?.ok_or("Контейнер не найден.")?;
        let original = self.resolve_path(&path);
        let trash = original.with_extension("pending-delete");
        if let Some(store) = guard(&self.stores)?.remove(&id) {
            store.lock()?;
            drop(store);
        }
        guard(&self.sessions)?.retain(|_, container_id| container_id != &id);
        fs::rename(&original, &trash).map_err(|e| format!("Не удалось удалить контейнер: {e}"))?;
        guard(&self.index)?
            .execute("DELETE FROM containers WHERE id=?1", [&id])
            .map_err(db_error)?;
        let pending = self.pending.clone();
        guard(&pending)?.insert(
            id.clone(),
            PendingDelete {
                id: id.clone(),
                original,
                trash: trash.clone(),
                name,
                hidden_hash,
                mode,
                created_at,
                passes,
            },
        );
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(30));
            if let Ok(mut items) = pending.lock() {
                if let Some(item) = items.remove(&id) {
                    secure_remove(&item.trash, item.passes);
                }
            }
        });
        Ok(())
    }

    pub fn undo_delete(&self, id: String) -> Result<()> {
        let item = guard(&self.pending)?
            .remove(&id)
            .ok_or("Окно отмены истекло.")?;
        fs::rename(&item.trash, &item.original)
            .map_err(|e| format!("Не удалось восстановить контейнер: {e}"))?;
        guard(&self.index)?
            .execute(
                "INSERT INTO containers VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    item.id,
                    item.name,
                    item.hidden_hash,
                    item.original.to_string_lossy().to_string(),
                    item.mode,
                    item.created_at
                ],
            )
            .map_err(db_error)?;
        Ok(())
    }

    pub fn unlock(
        &self,
        id: Option<String>,
        name: Option<String>,
        password: String,
    ) -> Result<Login> {
        let record = self.record(id.as_deref(), name.as_deref())?;
        let store = self.store(&record)?;
        let login = store
            .unlock_at_epoch(password, store.authentication_epoch())
            .map_err(|_| "Контейнер не найден или неверные данные доступа.".to_string())?;
        guard(&self.sessions)?.insert(login.token.clone(), record.id);
        Ok(login)
    }

    pub fn recovery_question(
        &self,
        id: Option<String>,
        name: Option<String>,
    ) -> Result<Option<String>> {
        let record = self.record(id.as_deref(), name.as_deref())?;
        self.store(&record)?.recovery_question()
    }

    pub fn recover(
        &self,
        id: Option<String>,
        name: Option<String>,
        answer: String,
        new_password: String,
    ) -> Result<Login> {
        let record = self.record(id.as_deref(), name.as_deref())?;
        let store = self.store(&record)?;
        let login = store
            .recover_at_epoch(answer, new_password, store.authentication_epoch())
            .map_err(|_| "Неверный ответ или восстановление не настроено.".to_string())?;
        guard(&self.sessions)?.insert(login.token.clone(), record.id);
        Ok(login)
    }

    pub fn open_external(&self, token: &str, id: &str) -> Result<()> {
        let store = self.for_token(token)?;
        let snapshot = store.snapshot(token)?;
        let file = snapshot
            .files
            .into_iter()
            .find(|file| file.id == id)
            .ok_or("Файл не найден.")?;
        let extension = file
            .name
            .rsplit_once('.')
            .map(|(_, value)| value)
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 12
                    && value.chars().all(|c| c.is_ascii_alphanumeric())
            })
            .unwrap_or("bin");
        let directory = std::env::temp_dir().join("vault-calculator-open");
        fs::create_dir_all(&directory)
            .map_err(|e| format!("Не удалось создать временную папку: {e}"))?;
        let path = directory.join(format!("{}.{}", Uuid::new_v4(), extension));
        let mut bytes = store.read(token, id)?;
        fs::write(&path, &bytes).map_err(|e| format!("Не удалось подготовить файл: {e}"))?;
        bytes.zeroize();
        open_path(&path)?;
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(600));
            secure_remove(&path, 1);
        });
        Ok(())
    }

    pub fn erase_external(&self, path: String, passes: u8) -> Result<()> {
        if ![0, 3].contains(&passes) {
            return Err("Допустимо 0 или 3 прохода очистки.".into());
        }
        let path = PathBuf::from(path);
        if !path.is_file() {
            return Err("Исходный файл не найден.".into());
        }
        secure_remove(&path, passes);
        if path.exists() {
            return Err("Не удалось удалить исходный файл.".into());
        }
        Ok(())
    }

    fn for_token(&self, token: &str) -> Result<Arc<Store>> {
        let id = guard(&self.sessions)?
            .get(token)
            .cloned()
            .ok_or("Хранилище заблокировано. Войдите снова.")?;
        guard(&self.stores)?
            .get(&id)
            .cloned()
            .ok_or("Хранилище заблокировано. Войдите снова.".into())
    }

    pub fn lock(&self) -> Result<()> {
        for store in guard(&self.stores)?.values() {
            store.lock()?;
        }
        guard(&self.sessions)?.clear();
        clean_temp_files();
        Ok(())
    }

    pub fn revoke(&self, token: &str) -> Result<()> {
        if let Ok(store) = self.for_token(token) {
            store.revoke_session(token)?;
        }
        guard(&self.sessions)?.remove(token);
        Ok(())
    }

    pub fn touch(&self, token: &str) -> Result<()> {
        self.for_token(token)?.touch(token)
    }
    pub fn snapshot(&self, token: &str) -> Result<Snapshot> {
        self.for_token(token)?.snapshot(token)
    }
    pub fn import(&self, token: &str, name: String, data: &[u8]) -> Result<VaultFile> {
        self.for_token(token)?.import(token, name, data)
    }
    pub fn read(&self, token: &str, id: &str) -> Result<Vec<u8>> {
        self.for_token(token)?.read(token, id)
    }
    pub fn rename(&self, token: &str, id: &str, name: &str) -> Result<()> {
        self.for_token(token)?.rename(token, id, name)
    }
    pub fn delete_file(&self, token: &str, id: &str) -> Result<()> {
        self.for_token(token)?.delete(token, id)
    }
    pub fn save_settings(
        &self,
        token: &str,
        settings: Settings,
        new_password: Option<String>,
        recovery_answer: Option<String>,
    ) -> Result<()> {
        self.for_token(token)?
            .save_settings(token, settings, new_password, recovery_answer)
    }
}

fn secure_remove(path: &Path, passes: u8) {
    let Ok(mut file) = fs::OpenOptions::new().read(true).write(true).open(path) else {
        let _ = fs::remove_file(path);
        return;
    };
    let Ok(length) = file.metadata().map(|meta| meta.len()) else {
        let _ = fs::remove_file(path);
        return;
    };
    let mut block = vec![0u8; 1024 * 1024];
    for _ in 0..passes {
        if file.seek(SeekFrom::Start(0)).is_err() {
            break;
        }
        let mut left = length;
        while left > 0 {
            OsRng.fill_bytes(&mut block);
            let size = left.min(block.len() as u64) as usize;
            if file.write_all(&block[..size]).is_err() {
                break;
            }
            left -= size as u64;
        }
        let _ = file.flush();
        let _ = file.sync_all();
    }
    let _ = file.flush();
    let _ = file.sync_all();
    drop(file);
    let _ = fs::remove_file(path);
}

fn clean_temp_files() {
    let directory = std::env::temp_dir().join("vault-calculator-open");
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            secure_remove(&entry.path(), 1);
        }
    }
}

fn open_path(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", ""]).arg(path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    command
        .spawn()
        .map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    Ok(())
}
