mod manager;
mod store;

use manager::{Manager as ContainerManager, ManagerStatus};
use std::sync::Arc;
use store::{Login, Result, Settings, Snapshot, VaultFile};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager, State,
};

type Vault = Arc<ContainerManager>;

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "Операция прервана.".to_string())?
}

#[tauri::command]
fn vault_status(state: State<'_, Vault>) -> Result<ManagerStatus> {
    state.status()
}

#[tauri::command]
async fn create_container(
    state: State<'_, Vault>,
    name: String,
    hidden: bool,
    password: String,
    location: Option<String>,
) -> Result<Login> {
    let store = state.inner().clone();
    blocking(move || store.create(name, hidden, password, location)).await
}

#[tauri::command]
fn delete_container(state: State<'_, Vault>, id: String, passes: u8) -> Result<()> {
    state.delete(id, passes)
}

#[tauri::command]
async fn erase_external_file(state: State<'_, Vault>, path: String, passes: u8) -> Result<()> {
    let store = state.inner().clone();
    blocking(move || store.erase_external(path, passes)).await
}

#[tauri::command]
fn undo_delete_container(state: State<'_, Vault>, id: String) -> Result<()> {
    state.undo_delete(id)
}

#[tauri::command]
async fn unlock_container(
    state: State<'_, Vault>,
    id: Option<String>,
    name: Option<String>,
    password: String,
) -> Result<Login> {
    let store = state.inner().clone();
    blocking(move || store.unlock(id, name, password)).await
}

#[tauri::command]
async fn recovery_question(
    state: State<'_, Vault>,
    id: Option<String>,
    name: Option<String>,
) -> Result<Option<String>> {
    let store = state.inner().clone();
    blocking(move || store.recovery_question(id, name)).await
}

#[tauri::command]
async fn recover_vault(
    state: State<'_, Vault>,
    id: Option<String>,
    name: Option<String>,
    answer: String,
    new_password: String,
) -> Result<Login> {
    let store = state.inner().clone();
    blocking(move || store.recover(id, name, answer, new_password)).await
}

#[tauri::command]
fn lock_vault(state: State<'_, Vault>) -> Result<()> {
    state.lock()
}

#[tauri::command]
fn revoke_session(state: State<'_, Vault>, token: String) -> Result<()> {
    state.revoke(&token)
}

#[tauri::command]
fn touch_session(state: State<'_, Vault>, token: String) -> Result<()> {
    state.touch(&token)
}

#[tauri::command]
async fn vault_snapshot(state: State<'_, Vault>, token: String) -> Result<Snapshot> {
    let store = state.inner().clone();
    blocking(move || store.snapshot(&token)).await
}

#[tauri::command]
async fn import_file(state: State<'_, Vault>, request: Request<'_>) -> Result<VaultFile> {
    let token = request
        .headers()
        .get("x-vault-token")
        .and_then(|v| v.to_str().ok())
        .ok_or("Нет сессии.")?
        .to_owned();
    let name = request
        .headers()
        .get("x-vault-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("Нет имени файла.")?;
    let name = percent_encoding::percent_decode_str(name)
        .decode_utf8()
        .map_err(|_| "Некорректное имя файла.")?
        .into_owned();
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Ожидались двоичные данные.".into());
    };
    if data.len() > store::MAX_FILE_SIZE {
        return Err("Один файл может занимать до 32 МиБ.".into());
    }
    let data = data.clone();
    let store = state.inner().clone();
    blocking(move || store.import(&token, name, &data)).await
}

#[tauri::command]
async fn export_file(state: State<'_, Vault>, token: String, id: String) -> Result<Response> {
    let store = state.inner().clone();
    blocking(move || store.read(&token, &id).map(Response::new)).await
}

#[tauri::command]
async fn open_external(state: State<'_, Vault>, token: String, id: String) -> Result<()> {
    let store = state.inner().clone();
    blocking(move || store.open_external(&token, &id)).await
}

#[tauri::command]
async fn rename_file(
    state: State<'_, Vault>,
    token: String,
    id: String,
    name: String,
) -> Result<()> {
    let store = state.inner().clone();
    blocking(move || store.rename(&token, &id, &name)).await
}

#[tauri::command]
async fn delete_file(state: State<'_, Vault>, token: String, id: String) -> Result<()> {
    let store = state.inner().clone();
    blocking(move || store.delete_file(&token, &id)).await
}

#[tauri::command]
async fn save_settings(
    state: State<'_, Vault>,
    token: String,
    settings: Settings,
    new_password: Option<String>,
    recovery_answer: Option<String>,
) -> Result<()> {
    let store = state.inner().clone();
    blocking(move || store.save_settings(&token, settings, new_password, recovery_answer)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let store = ContainerManager::open(&directory).map_err(std::io::Error::other)?;
            app.manage(Arc::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            create_container,
            delete_container,
            erase_external_file,
            undo_delete_container,
            unlock_container,
            recovery_question,
            recover_vault,
            lock_vault,
            revoke_session,
            touch_session,
            vault_snapshot,
            import_file,
            export_file,
            open_external,
            rename_file,
            delete_file,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Calculator");
}
