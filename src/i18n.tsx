import { createContext, useContext, useState, type ReactNode } from 'react';

export type Language = 'en' | 'ru';
const storageKey = 'vault-language';

const ru: Record<string, string> = {
  'English': 'Английский', 'Russian': 'Русский', 'Language': 'Язык',
  'Calculator': 'Калькулятор', 'Standard': 'Стандартный', 'SIMPLE. EVERY DAY.': 'ПРОСТО. КАЖДЫЙ ДЕНЬ.', 'It all adds up.': 'Всё сходится.',
  'A little order\nin everyday numbers.': 'Немного порядка\nв повседневных числах.', 'Result': 'Результат', 'Delete digit': 'Удалить цифру', 'Decimal point': 'Десятичная точка', 'Number base': 'Система счисления',
  'Hold = · ': 'Удерживайте = · ', 'additional functions': 'дополнительные функции', 'Less clutter. More clarity.': 'Меньше лишнего. Больше ясности.', 'Error': 'Ошибка',
  'Could not confirm locking. Close the application.': 'Не удалось подтвердить блокировку. Закройте приложение.',
  'Back to calculator': 'К калькулятору', 'INDEPENDENT CONTAINERS': 'НЕЗАВИСИМЫЕ КОНТЕЙНЕРЫ', 'Reset password.': 'Сброс пароля.', 'New container.': 'Новый контейнер.',
  'Hidden container.': 'Скрытый контейнер.', 'Choose a space.': 'Выберите пространство.', 'The name, password, and key belong only to this container.': 'Имя, пароль и ключ относятся только к этому контейнеру.',
  'Enter the exact name and password.': 'Введите точное имя и пароль.', 'Visible containers are available before sign-in.': 'Видимые контейнеры доступны до входа.', 'Password': 'Пароль',
  'Delete {{name}}': 'Удалить {{name}}', 'New password': 'Новый пароль', 'Repeat password': 'Повторите пароль', 'Reset password': 'Сбросить пароль', 'Container name': 'Имя контейнера',
  'Hide from list': 'Скрыть из списка', 'The exact name will be required to sign in': 'Для входа потребуется точное имя', 'Storage folder: {{location}}': 'Папка хранения: {{location}}', 'default': 'по умолчанию',
  'Create a password': 'Придумайте пароль', 'Show password': 'Показать пароль', 'Copy password': 'Копировать пароль', 'Generate name and password': 'Сгенерировать имя и пароль',
  'Checking…': 'Проверяем…', 'Create container': 'Создать контейнер', 'Open container': 'Открыть контейнер', 'Show visible': 'К видимым', 'Open hidden': 'Открыть скрытый', 'Forgot password?': 'Забыли пароль?',
  'Cancel': 'Отмена', 'New container': 'Новый контейнер', 'Container deleted. {{seconds}} sec remaining.': 'Контейнер удалён. Осталось {{seconds}} сек.', 'Undo': 'Отменить',
  'Local encrypted files': 'Локальные зашифрованные файлы', 'Each container has a separate database and key. Visible names are not encrypted.': 'Каждый контейнер имеет отдельную базу и ключ. Видимые имена не шифруются.',
  'Browser session storage': 'Хранилище сеанса браузера', 'Data is kept only in this browser tab and is cleared when it closes or reloads.': 'Данные хранятся только в этой вкладке браузера и удаляются при её закрытии или обновлении.',
  'Passwords do not match.': 'Пароли не совпадают.', 'No recovery question is configured for this container.': 'Для этого контейнера контрольный вопрос не настроен.',
  'Use three-pass erasure after 30 seconds?': 'Использовать трёхпроходное затирание после 30 секунд?',
  'PERSONAL SPACE': 'ЛИЧНОЕ ПРОСТРАНСТВО', 'Main navigation': 'Основная навигация', 'My files': 'Мои файлы', 'Settings': 'Настройки', 'Only on this device': 'Только на этом устройстве',
  'Your space.\nNo accounts or cloud.': 'Ваше пространство.\nБез аккаунтов и облака.', 'XChaCha20 · local': 'XChaCha20 · локально', 'Browser session · memory only': 'Сеанс браузера · только память',
  'Personal': 'Личное', 'Lock': 'Заблокировать', 'EVERYTHING IN ONE PLACE': 'ВСЁ В ОДНОМ МЕСТЕ', 'UNDER YOUR CONTROL': 'ПОД ВАШИМ КОНТРОЛЕМ',
  'What matters is always close at hand.': 'То, что важно, — всегда под рукой.', 'Your device. Your rules.': 'Ваше устройство. Ваши правила.', 'Add files': 'Добавить файлы',
  'Encrypted container is active.': 'Зашифрованный контейнер активен.', 'Names and contents are protected with integrity checks.': 'Имена и содержимое защищены с проверкой целостности.',
  'Browser session is active.': 'Сеанс браузера активен.', 'Data remains in memory until this tab is closed or reloaded.': 'Данные остаются в памяти до закрытия или обновления вкладки.',
  'Dismiss message': 'Скрыть сообщение', 'Vault statistics': 'Статистика хранилища', 'Total files': 'Всего файлов', 'in vault': 'в хранилище', 'File storage': 'Занято файлами', 'Password check': 'Проверка пароля',
  'Browser': 'Браузер', 'Search files': 'Поиск файлов', 'Find something…': 'Найти что-нибудь…', 'Clear search': 'Очистить поиск', 'Sort': 'Сортировка', 'Newest first': 'Сначала новые', 'By name': 'По имени', 'By size': 'По размеру',
  'Grid': 'Сетка', 'List': 'Список', 'File type': 'Тип файлов', 'All files': 'Все файлы', 'Images': 'Изображения', 'Documents': 'Документы', 'Archives': 'Архивы', 'Other': 'Другое',
  'Working…': 'Выполняем операцию…', 'Nothing found': 'Ничего не нашлось', 'Space for your files': 'Место для ваших файлов', 'Try another name or choose another category.': 'Попробуйте другое имя или выберите другую категорию.',
  'Documents, photos, archives —\nadd your first file to get started.': 'Документы, фотографии, архивы —\nдобавьте первый файл, чтобы начать.', 'Choose files': 'Выбрать файлы', 'Showing 0 of {{count}}': 'Показано 0 из {{count}}',
  'or drag them here · up to 32 MiB per file': 'или перетащите их сюда · до 32 МиБ на файл', 'Local storage': 'Локальное хранение', '{{shown}} of {{total}} files': '{{shown}} из {{total}} файлов', 'Files to import': 'Файлы для импорта',
  'Preview {{name}}': 'Просмотреть {{name}}', 'Preview': 'Просмотреть', 'Open {{name}} externally': 'Открыть {{name}} во внешнем приложении', 'Open externally': 'Открыть в…', 'Export {{name}}': 'Экспортировать {{name}}', 'Export': 'Экспортировать',
  'Rename {{name}}': 'Переименовать {{name}}', 'Rename': 'Переименовать', 'Rename file': 'Переименовать файл', 'Delete file?': 'Удалить файл?', 'File name': 'Имя файла', 'Save': 'Сохранить', 'Delete': 'Удалить', 'Please wait…': 'Подождите…', 'Close': 'Закрыть',
  '“{{name}}” will be removed from the vault. The source file outside it will remain in place.': '«{{name}}» будет удалён из хранилища. Исходный файл за его пределами останется на месте.', 'No built-in preview is available for this format.': 'Для этого формата нет встроенного просмотра.',
  'File {{number}}': 'Файл {{number}}', 'File exported.': 'Файл экспортирован.', 'Opened externally. The temporary copy will be deleted automatically.': 'Открыто во внешнем приложении. Временная копия будет удалена автоматически.',
  'File name changed.': 'Имя файла изменено.', 'File removed from vault.': 'Файл удалён из хранилища.', 'Session ended.': 'Сессия завершена.', 'Settings saved.': 'Настройки сохранены.',
  'What should happen to source files after successful import: keep, delete, or 3 passes?': 'Что сделать с исходниками после успешного импорта: оставить, удалить или 3 прохода?', 'keep': 'оставить', 'delete': 'удалить', '3 passes': '3 прохода',
  'File “{{name}}” already exists. Enter: replace, copy, or skip': 'Файл «{{name}}» уже существует. Введите: заменить, копия или пропустить', 'copy': 'копия', 'skip': 'пропустить', 'replace': 'заменить',
  'Adding {{current}} of {{total}}…': 'Добавляем {{current}} из {{total}}…', 'exceeds the 32 MiB limit': 'превышен лимит 32 МиБ', 'Files added: {{count}}.': 'Добавлено файлов: {{count}}.', ' Failed: {{errors}}': ' Не удалось: {{errors}}', ' Originals remained in place.': ' Оригиналы остались на месте.',
  'Theme': 'Тема', 'Calculator and vault appearance': 'Оформление калькулятора и хранилища', 'Forest': 'Лес', 'Midnight': 'Полночь', 'Graphite': 'Графит', 'Ocean': 'Океан', 'Violet': 'Фиолет', 'Rose': 'Роза', 'Aurora': 'Аврора', 'Ember': 'Уголь', 'White': 'Белая', 'Arctic': 'Арктика', 'Sunset': 'Закат', 'Mint': 'Мята', 'Copper': 'Медь', 'Neon': 'Неон', 'Sand': 'Песок', 'Crimson': 'Багряная', 'Hacker': 'Хакер', 'Custom': 'Своя',
  'Custom accent color': 'Свой акцентный цвет', 'Full color editor': 'Полный редактор цветов', 'Switches to Custom theme and applies every color live.': 'Переключает на свою тему и сразу применяет каждый цвет.', 'Reset colors': 'Сбросить цвета',
  'Background': 'Фон', 'Surface': 'Панели', 'Raised surface': 'Верхний слой', 'Borders': 'Границы', 'Text': 'Текст', 'Muted text': 'Приглушённый текст', 'Accent': 'Акцент', 'Secondary accent': 'Второй акцент', 'Danger': 'Опасность',
  'App branding': 'Брендинг приложения', 'Shown inside the vault on every platform.': 'Показывается внутри хранилища на всех платформах.', 'App name': 'Название приложения', 'App icon': 'Иконка приложения', 'Custom icon text': 'Свой текст иконки',
  'Mask file names': 'Маскировать имена файлов', 'Show “File 1”, “File 2” instead of names': 'Вместо названий показывать «Файл 1», «Файл 2»', 'Secure record deletion': 'Безопасное удаление записей', 'SQLite wipes freed pages': 'SQLite затирает освобождённые страницы',
  'Protection mode': 'Режим защиты', 'Argon2id password-checking cost': 'Стоимость проверки пароля через Argon2id', 'Fast': 'Быстрый', 'Balanced': 'Сбалансированный', 'Strong': 'Сильный', 'Maximum': 'Максимальный',
  'For low-powered devices': 'Для слабых устройств', 'For everyday use': 'На каждый день', 'More resistant to guessing': 'Больше затрат на перебор', 'For powerful devices': 'Для мощных устройств', '{{count}} passes': '{{count}} прохода',
  'A heavier mode increases key derivation time. Files and names are protected by XChaCha20-Poly1305.': 'Более тяжёлый режим увеличивает время получения ключа. Файлы и имена защищены XChaCha20-Poly1305.',
  'Auto-lock': 'Автоблокировка', 'Return to calculator after inactivity': 'Возврат к калькулятору после бездействия', 'Lock after': 'Блокировать через', '1 minute': '1 минуту', '5 minutes': '5 минут', '15 minutes': '15 минут',
  'When the application is hidden': 'При скрытии приложения', 'System file selection is excluded': 'Системный выбор файла — исключение', 'Hold the = button': 'Удержание кнопки =', 'Open sign-in with a long press; Alt+V remains available': 'Открывать вход долгим нажатием; Alt+V остаётся доступен',
  'Password recovery': 'Восстановление пароля', 'The question is stored as text; the answer only as an Argon2id hash': 'Контрольный вопрос хранится открыто, ответ — только как Argon2id-хеш', 'Allow password reset': 'Разрешить сброс пароля',
  'Recovery question': 'Контрольный вопрос', 'Answer': 'Ответ', 'leave blank to keep unchanged': 'оставьте пустым без изменений', 'required': 'обязательно', 'Use a long unique answer. It wraps the same random container key and allows a forgotten password to be replaced.': 'Используйте длинный уникальный ответ. Он оборачивает тот же случайный ключ контейнера и позволяет заменить забытый пароль.',
  'Confirm changes': 'Подтверждение изменений', 'Your current password is required to apply changes': 'Текущий пароль нужен для применения изменений', 'Current password': 'Текущий пароль', 'Save changes': 'Сохранение изменений', 'Unlocked sessions can apply settings without re-entering the current password': 'Открытая сессия применяет настройки без повторного ввода текущего пароля', 'optional': 'необязательно', 'Repeat new password': 'Повтор нового пароля', 'Applying…': 'Применяем…', 'Save settings': 'Сохранить настройки',
  'New passwords do not match.': 'Новые пароли не совпадают.', 'What Emergency Lock does': 'Что делает Emergency Lock', 'Hides the interface, revokes the session, and removes the key from active memory. Already exported files remain outside.': 'Скрывает интерфейс, отзывает сессию и удаляет ключ из активной памяти. Уже экспортированные файлы остаются снаружи.',
  'Vault is locked. Sign in again.': 'Хранилище заблокировано. Войдите снова.', 'Name must be 1–200 characters, without reserved characters or a trailing period.': 'Имя: 1–200 символов, без служебных символов и точки в конце.', 'Password must be at least 8 characters and at most 1024 bytes.': 'Пароль: минимум 8 символов, максимум 1024 байта.',
  'Enter a container name.': 'Введите имя контейнера.', 'A container with this visible name already exists.': 'Контейнер с таким видимым именем уже существует.', 'Container not found or access details are incorrect.': 'Контейнер не найден или неверные данные доступа.', 'Incorrect answer.': 'Неверный ответ.', 'No container selected.': 'Контейнер не выбран.',
  'A file may be up to 32 MiB.': 'Один файл может занимать до 32 МиБ.', 'File not found.': 'Файл не найден.', 'Opening in an external application is available only in the desktop application.': 'Открытие во внешнем приложении доступно только в настольном приложении.', 'Incorrect password.': 'Неверный пароль.', 'Enter an answer for the recovery question.': 'Введите ответ для контрольного вопроса.',
  'Container folder': 'Папка для контейнера', 'Import files': 'Добавить файлы', 'File': 'Файл', 'Import-{{date}}-{{index}}': 'Импорт-{{date}}-{{index}}', 'Export file': 'Экспортировать файл', 'MiB': 'МиБ',
  'No session.': 'Нет сессии.', 'No file name.': 'Нет имени файла.', 'Invalid file name.': 'Некорректное имя файла.', 'Binary data was expected.': 'Ожидались двоичные данные.', 'Container not found.': 'Контейнер не найден.',
  'Could not protect the container name.': 'Не удалось защитить имя контейнера.', 'Only 0 or 3 wipe passes are allowed.': 'Допустимо 0 или 3 прохода очистки.', 'The undo window has expired.': 'Окно отмены истекло.',
  'The answer is incorrect or recovery is not configured.': 'Неверный ответ или восстановление не настроено.', 'Source file not found.': 'Исходный файл не найден.', 'Could not delete the source file.': 'Не удалось удалить исходный файл.',
  'Unknown theme.': 'Неизвестная тема.', 'Unknown protection mode.': 'Неизвестный режим защиты.', 'Invalid settings.': 'Некорректные настройки.', 'Invalid branding settings.': 'Некорректные настройки бренда.', 'Invalid interface color.': 'Некорректный цвет интерфейса.',
  'Vault already exists.': 'Хранилище уже создано.', 'The password record is damaged.': 'Повреждена запись пароля.', 'Create a vault first.': 'Сначала создайте хранилище.', 'Password recovery is not configured.': 'Восстановление пароля не настроено.',
  'System clock error.': 'Ошибка системных часов.', 'Enter the answer again to update protection.': 'Введите ответ заново для обновления защиты.', 'Could not process the password.': 'Не удалось обработать пароль.',
  'Could not derive the encryption key.': 'Не удалось получить ключ шифрования.', 'Encryption key error.': 'Ошибка ключа шифрования.', 'Could not protect the vault key.': 'Не удалось защитить ключ хранилища.',
  'The key container is damaged.': 'Повреждён контейнер ключа.', 'Could not open the vault key.': 'Не удалось открыть ключ хранилища.', 'Could not encrypt data.': 'Не удалось зашифровать данные.',
  'The encrypted container is damaged.': 'Повреждён зашифрованный контейнер.', 'The container is damaged or has been modified.': 'Контейнер повреждён или подменён.', 'An unencrypted file name was found.': 'Обнаружено незашифрованное имя файла.',
  'The file name is damaged.': 'Повреждено имя файла.', 'Unencrypted file data was found.': 'Обнаружены незашифрованные данные файла.', 'Recovery question must be 3–200 characters.': 'Контрольный вопрос: от 3 до 200 символов.', 'Answer must be at least 3 characters and at most 1024 bytes.': 'Ответ: минимум 3 символа, максимум 1024 байта.',
  'Operation cancelled.': 'Операция прервана.', 'Internal error. Restart the application.': 'Внутренняя ошибка. Перезапустите приложение.', 'Enter a new password to update protection.': 'Введите новый пароль для обновления защиты.'
};

let activeLanguage: Language = (() => {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'en' || saved === 'ru') return saved;
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
})();

export function translate(key: string, values: Record<string, string | number> = {}, language = activeLanguage): string {
  let value = language === 'ru' ? ru[key] ?? key : key;
  for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
}

const I18nContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: typeof translate } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState(activeLanguage);
  const setLanguage = (next: Language) => { activeLanguage = next; localStorage.setItem(storageKey, next); document.documentElement.lang = next; updateLanguage(next); };
  document.documentElement.lang = language;
  return <I18nContext.Provider value={{ language, setLanguage, t: (key, values) => translate(key, values, language) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return <div className="language-switch" role="group" aria-label={t('Language')}><button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button><button type="button" className={language === 'ru' ? 'active' : ''} aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>RU</button></div>;
}
