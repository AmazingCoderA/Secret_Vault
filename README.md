# Secret Vault

A private local vault hidden behind a normal calculator.

<p align="center">
  <a href="https://github.com/AmazingCoderA/Secret_Vault/releases/latest"><strong>Download latest release</strong></a>
  &nbsp; · &nbsp;
  <a href="#русский"><strong>Русский</strong></a>
  &nbsp; · &nbsp;
  <a href="#english"><strong>English</strong></a>
</p>

> **Language button:** `EN` keeps the interface in English. `RU` switches it to Russian. With no saved choice, the app follows the operating system language and uses English as the fallback.

## English

## Overview

Secret Vault is a production-oriented Tauri 2 desktop/mobile app built with Rust, React, TypeScript, and Vite. The app opens as a clean calculator and unlocks encrypted file containers through a separate vault flow.

The UI uses English by default and switches to Russian automatically when the system language starts with `ru`. Users can change the language in the app at any time.

## Features

- Multiple independent vault containers.
- Visible and hidden containers.
- XChaCha20-Poly1305 authenticated encryption for file names and contents.
- Argon2id password hashing and key derivation profiles.
- Password recovery through an optional security question.
- Auto-lock, lock-on-hide, and Emergency Lock.
- Built-in preview for images, text, PDF, audio, and video.
- External open through temporary files with automatic cleanup.
- Import conflict handling: replace, copy, or skip.
- Optional source cleanup after import: keep, delete, or three-pass overwrite.
- File masking, accent color, and eight visual themes.
- Windows, Linux, Android, and Flatpak CI builds.

## Quick Tricks

- Press `Alt+V` from the calculator to open the vault instantly.
- Hold `=` for about one second to enter the vault without a visible shortcut.
- Press `Esc` or use **Emergency Lock** to revoke the active session immediately.
- Turn on filename masking when you want a neutral file list inside the vault.
- Pick a different accent color for every container and use Aurora or Ember for a stronger visual identity.
- Choose the recovery question in Settings before you need it. The answer is stored as an Argon2id hash, not as plain text.
- Use the standalone Linux binary when you want a portable install with no package manager.

## Requirements

- Node.js 22+.
- Rust stable.
- Windows: Visual Studio Build Tools with C++ desktop workload, Windows SDK, and WebView2.
- Linux: WebKitGTK 4.1 and AppIndicator development packages.
- Android: JDK 17, Android SDK, NDK, and Tauri Android prerequisites.

## Development

```powershell
npm install
npm run tauri dev
```

Browser preview:

```powershell
npm run dev
```

The browser preview is useful for UI work. Secure persistent storage is provided by the native Tauri build.

## Build

Windows installer:

```powershell
npm run tauri build -- --bundles nsis
```

Linux packages are built in CI as AppImage and DEB artifacts.

Android debug APK is built in CI. Local Android setup follows the official Tauri Android prerequisites.

## Linux Installation

### Ubuntu / Debian

Download the `.deb` package from [Releases](https://github.com/AmazingCoderA/Secret_Vault/releases/latest), then run:

```bash
sudo apt install ./secret-vault_*.deb
```

For a portable install, download the AppImage:

```bash
chmod +x Secret_Vault_*.AppImage
./Secret_Vault_*.AppImage
```

### Arch Linux

Download the AppImage or standalone binary from [Releases](https://github.com/AmazingCoderA/Secret_Vault/releases/latest):

```bash
chmod +x Secret_Vault_*.AppImage
./Secret_Vault_*.AppImage
```

The standalone `secret-vault-linux-x86_64` binary needs the standard WebKitGTK runtime libraries. On Arch:

```bash
sudo pacman -S webkit2gtk-4.1 libayatana-appindicator librsvg
chmod +x secret-vault-linux-x86_64
./secret-vault-linux-x86_64
```

### Flatpak

Download `secret-vault.flatpak` from [Releases](https://github.com/AmazingCoderA/Secret_Vault/releases/latest):

```bash
flatpak install --user ./secret-vault.flatpak
flatpak run app.local.vaultcalculator
```

## Release Downloads

Every `v*` tag publishes one GitHub Release containing Windows NSIS, Linux AppImage/DEB/standalone binary, macOS DMG, Android APK, and Flatpak. The release page is the main download button for end users.

## Tests

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## GitHub Actions

- `CI` runs frontend tests, frontend build, Rust tests, and clippy.
- `Mobile and Linux` builds Windows NSIS, Linux AppImage/DEB, and Android debug APK artifacts.
- `Flatpak` builds a Flatpak artifact.
- `Release` builds tagged release artifacts.

Artifacts are available from the corresponding workflow run on GitHub.

## Storage Notes

- Containers are local SQLite databases.
- Visible container names are stored in the container index so they can be shown before unlock.
- Hidden containers require the exact name and password.
- Files are currently limited to 32 MiB each and are processed in memory.
- Three-pass overwrite cannot guarantee physical erasure on SSDs because of wear leveling.

## Structure

```text
src/
  App.tsx                 session routing, lock logic, app state
  api.ts                  Tauri IPC, file dialogs, browser preview fallback
  i18n.tsx                English/Russian localization
  calculator.ts           calculator logic
  components/             UI screens and dialogs
src-tauri/
  src/store.rs            encrypted SQLite vault storage
  src/manager.rs          container manager and external open handling
  src/lib.rs              Tauri commands and mobile entry point
packaging/                Flatpak metadata and manifest
tests/                    Playwright UI tests
```

## Русский

Secret Vault — локальное зашифрованное хранилище, скрытое за обычным калькулятором.

- Английский язык включён по умолчанию.
- Для русской локали системы приложение автоматически выбирает русский язык.
- Кнопки `EN` и `RU` позволяют сменить язык вручную.
- Контрольный вопрос включается в настройках контейнера.
- В релизах доступны Windows, Linux AppImage/DEB/бинарник, macOS, Android APK и Flatpak.
- Для Linux можно использовать AppImage без установки или standalone-бинарник.
