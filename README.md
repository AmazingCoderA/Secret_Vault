# Secret_Vault
A private shadow storage!

## Vault · Calculator

Первый рабочий этап концепции **«калькулятор снаружи → файловое хранилище внутри»**.

**Стек:** Rust, Tauri 2, React, TypeScript, Vite. Одна кодовая база для Windows и Android; русскоязычный адаптивный интерфейс в стиле Material 3 с тёмной зелёно-синей палитрой.

## Запуск на Windows

В этой рабочей папке уже собран и проверен запуск **`src-tauri/target/debug/vault-calculator.exe`**. Его можно открыть напрямую, без запуска Vite.

Нужны Node.js 22.12+ или 24+, Rust и Visual Studio Build Tools с компонентом «Разработка классических приложений на C++», Windows SDK и WebView2.

```powershell
npm install
npm run tauri dev
```

Первый запуск Cargo скачивает и компилирует зависимости и может занять несколько минут.

Сборка установщика:

```powershell
npm run tauri build
```

Результат: `src-tauri/target/release/bundle/nsis/`.

Быстрая отладочная сборка отдельного `.exe` без установщика:

```powershell
npm run tauri -- build --debug --no-bundle
```

### Быстро посмотреть интерфейс

```powershell
npm run dev
```

Открыть **http://127.0.0.1:1420**. Браузерный режим — отдельная демонстрация: файлы и пароль живут только в памяти вкладки, данные теряются при обновлении. Это не замена нативному хранилищу. В демо нет Argon2id; он реализован в Rust.

## Как пользоваться

1. При запуске отображается обычный калькулятор. Он поддерживает клавиатуру, проценты, смену знака и повторное `=`. Вычисления последовательные, как на стандартном карманном калькуляторе.
2. **Удерживать `=` примерно секунду**, нажать подпись под клавиатурой или `Alt+V` — открыть вход.
3. При первом входе задать пароль от восьми символов. При последующих — ввести его.
4. «Добавить файлы» открывает системный выбор. На Windows также можно перетащить файлы. Импорт копирует данные, оставляя оригиналы.
5. Доступны поиск, категории, сортировка, сетка/список, переименование, экспорт и удаление.
6. **Emergency Lock**, кнопка блокировки или **Esc** немедленно возвращают калькулятор и отзывают сессию.
7. Настройки позволяют выбрать профиль Argon2id, время автоблокировки, блокировку при скрытии и сменить пароль.

## Что реализовано

- Постоянное локальное хранение в SQLite; имена и содержимое файлов защищены XChaCha20-Poly1305 с уникальным nonce и привязкой к ID записи.
- Случайный 256-битный ключ хранилища обёрнут ключом из Argon2id. Пароль и ответ на контрольный вопрос сохраняются только как PHC-хеши.
- Непостоянные случайные токены сессии, проверка каждой операции на стороне Rust.
- Автоблокировка после 1 / 5 / 15 минут бездействия, блокировка при `visibilitychange` → hidden (кроме системного выбора файлов).
- Задержка после нескольких неверных паролей в рамках текущего процесса.
- SQLite-транзакции для файловых операций; тестируется перезапуск, точность экспорта, отзыв сессий и смена пароля.
- Вход и ресурсоёмкие операции выполняются вне UI-потока.

| Профиль | Память Argon2id | Проходы | Параллелизм |
|---|---:|---:|---:|
| Fast | 16 МиБ | 2 | 1 |
| Balanced | 32 МиБ | 3 | 1 |
| Strong | 64 МиБ | 3 | 1 |
| Maximum | 128 МиБ | 4 | 1 |

## Границы первого этапа

Существующая база автоматически и атомарно шифруется при первом успешном входе в новую версию. Размеры файлов, число записей и время добавления остаются видны в структуре SQLite.

- В Windows база: `%LOCALAPPDATA%\app.local.vaultcalculator\vault-prototype.sqlite3`; на Android — каталог данных приложения.
- До **32 МиБ на файл**: импорт и экспорт пока целиком в памяти. Размеры чанков **256 / 512 КиБ / 1 МиБ** сохраняются как настройка следующего этапа, но ещё не применяются.
- Emergency Lock скрывает интерфейс и отзывает сессию; не удаляет файлы и не скрывает приложение от ОС. Уже завершённый экспорт остаётся снаружи. Очистка памяти JS и снимков ОС не гарантируется.
- `visibilitychange` зависит от платформы/WebView. Нативная обработка Android lifecycle и защита снимков экрана — отдельная работа перед защищённым релизом.
- Экран-калькулятор — визуальная маска, не гарантия сокрытия наличия хранилища. В прототипе оставлен явный способ входа под клавиатурой.
- Защита от одновременной работы нескольких процессов с одной базой и восстановление забытого пароля пока не предусмотрены.

## Android

Установить Android Studio, Android SDK / Platform Tools, NDK (Side by side), JDK 17 или 21; настроить `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME` по [инструкции Tauri](https://v2.tauri.app/start/prerequisites/#android). Затем:

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android init
npm run tauri android dev
```

Сборка APK/AAB:

```powershell
npm run tauri android build
```

В проекте есть мобильная точка входа и системные плагины выбора/чтения файлов с поддержкой Android `content://` URI. Сейчас для таких импортов используется нейтральное имя `Импорт-…`, его можно изменить в интерфейсе; чтение исходного display name через Android ContentResolver ещё нужно добавить. Сборку и поведение на реальном телефоне необходимо проверить после настройки SDK/NDK.

## Автосборка и релизы

- GitHub запускает тесты при каждом push/PR (`.github/workflows/ci.yml`).
- При каждом push/PR дополнительно собираются Windows NSIS, Linux AppImage/DEB, Android debug APK и Flatpak (`.github/workflows/platforms.yml`, `.github/workflows/flatpak.yml`). Файлы лежат во вкладке workflow в разделе Artifacts.
- Тег `v0.1.0` запускает черновик GitHub Release с NSIS для Windows, AppImage/DEB для Linux, DMG для macOS и отдельным Flatpak-файлом.
- Flatpak с ветки `main` также доступен в Artifacts запуска workflow `Flatpak`.
- Codeberg проверяется через Woodpecker (`.woodpecker.yml`): подключить репозиторий на CI-сервисе Codeberg и разрешить сборки. Forgejo Actions требует собственного runner, поэтому конфиг не дублируется.

Первичная публикация:

```powershell
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add github https://github.com/USER/REPO.git
git remote add codeberg https://codeberg.org/USER/REPO.git
git push -u github main
git push -u codeberg main
git tag v0.1.0
git push github v0.1.0
git push codeberg v0.1.0
```

Перед публичной публикацией заменить временный идентификатор `app.local.vaultcalculator` на принадлежащий проекту reverse-DNS App ID (например, `io.github.USER.VaultCalculator`) одновременно в `src-tauri/tauri.conf.json` и `packaging/`. Для отправки во Flathub также нужны открытая лицензия, URL проекта и скриншоты в AppStream metadata. Текущий Flatpak использует сеть во время сборки и предназначен для CI-артефактов; официальный Flathub потребует зафиксированные offline-источники npm и Cargo.

### GitHub

```powershell
git add .
git commit -m "Update app"
git push origin main
```

Открыть GitHub → **Actions** → workflow **Mobile and Linux** или **Flatpak** → скачать `Artifacts`. Для публичного релиза создать тег:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

После этого GitHub создаст черновик Release с Windows/Linux и Flatpak. Для Flathub: сначала заменить App ID и лицензие, затем создать репозиторий с таким ID в `flathub/flathub` через Pull Request. Flathub сам проверит manifest и будет собирать последующие версии по тегам.

## Проверки

```powershell
npm run build
npm test
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

E2E-тесты используют установленный Microsoft Edge, desktop и мобильный viewport. Они проверяют браузерный UI-прототип, а Rust-тесты отдельно проверяют постоянное хранилище и аутентификацию.

Проверено в текущем окружении Windows: production-сборка интерфейса, сборка и запуск отладочного `.exe`, 4 теста калькулятора, 3 Rust-теста и 6 E2E-сценариев. Android-сборка пока не проверена.

## Структура

```text
src/
  App.tsx                   маршруты, сессия, Emergency Lock, idle timer
  api.ts                    Tauri IPC + изолированное браузерное демо
  calculator.ts             логика калькулятора без eval
  components/               экраны и диалоги
  styles.css                адаптивная тёмная тема
src-tauri/
  src/store.rs              SQLite, Argon2id, сессии, файловые операции
  src/lib.rs                команды Tauri и mobile entry point
  capabilities/default.json права только на выбранные пользователем файлы
tests/                      E2E-сценарии
```

## Следующий этап: усиление контейнера

Текущая версия использует версионированные AEAD-записи и атомарную миграцию. Следующий этап — потоковое шифрование по чанкам, сокрытие размеров, резервное копирование контейнера и внешний аудит формата.

2048, Ping Pong и фонарик оставлены для следующих итераций после основного хранилища.
