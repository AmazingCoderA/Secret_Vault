import { test, expect, type Page } from '@playwright/test';

async function openEntry(page: Page) {
  await page.getByRole('button', { name: /Удерживайте =/ }).click();
}
async function createVault(page: Page) {
  await page.goto('/');
  await openEntry(page);
  await page.getByLabel('Придумайте пароль').fill('test password 123');
  await page.getByLabel('Повторите пароль').fill('test password 123');
  await page.getByRole('button', { name: 'Создать хранилище' }).click();
  await expect(page.getByRole('heading', { name: 'Мои файлы', exact: true })).toBeVisible();
}

test('calculator, import, rename, filter, lock and export round-trip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '7', exact: true }).click();
  await page.getByRole('button', { name: '+', exact: true }).click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: '=', exact: true }).click();
  await expect(page.getByLabel('Результат')).toHaveText('12');
  await openEntry(page);
  await page.getByLabel('Придумайте пароль').fill('test password 123');
  await page.getByLabel('Повторите пароль').fill('test password 123');
  await page.getByRole('button', { name: 'Создать хранилище' }).click();
  const content = Buffer.from('Hello Vault!\nПривет, мир.\x00', 'utf8');
  await page.getByLabel('Файлы для импорта').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: content },
    { name: 'empty.zip', mimeType: 'application/zip', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByRole('heading', { name: 'notes.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Переименовать notes.txt', exact: true }).click();
  await page.getByLabel('Имя файла', { exact: true }).fill('Заметки.txt');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заметки.txt', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('vault.png'), fullPage: true });
  await page.getByLabel('Поиск файлов').fill('нет такого файла');
  await expect(page.getByRole('heading', { name: 'Ничего не нашлось' })).toBeVisible();
  await page.getByLabel('Очистить поиск').click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспортировать Заметки.txt', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Заметки.txt');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(content);
  await page.getByRole('button', { name: /Emergency Lock/ }).click();
  await expect(page.getByLabel('Результат')).toHaveText('0');
  await expect(page.getByText('Заметки.txt', { exact: true })).toHaveCount(0);
  await openEntry(page);
  await page.getByLabel('Пароль', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Открыть хранилище' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный пароль.');
  await page.getByLabel('Пароль', { exact: true }).fill('test password 123');
  await page.getByRole('button', { name: 'Открыть хранилище' }).click();
  await expect(page.getByRole('heading', { name: 'Заметки.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить Заметки.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заметки.txt', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('settings, password rotation and automatic idle lock', async ({ page }) => {
  await createVault(page);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: /^Strong/ }).click();
  await page.getByRole('button', { name: '1 МиБ', exact: true }).click();
  await page.getByLabel('Блокировать через').selectOption('60');
  await page.getByLabel('Текущий пароль', { exact: true }).fill('test password 123');
  await page.getByLabel('Новый пароль (необязательно)', { exact: true }).fill('changed password 123');
  await page.getByLabel('Повтор нового пароля', { exact: true }).fill('changed password 123');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByRole('status')).toHaveText('Настройки сохранены.');
  await page.getByRole('button', { name: /Emergency Lock/ }).click();
  await openEntry(page);
  await page.getByLabel('Пароль', { exact: true }).fill('changed password 123');
  await page.getByRole('button', { name: 'Открыть хранилище' }).click();
  await expect(page.getByRole('heading', { name: 'Мои файлы', exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await expect(page.getByLabel('Результат')).toBeVisible();
});

test('long press opens entry and Escape hides a file dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '=', exact: true }).dispatchEvent('pointerdown', { button: 0 });
  await expect(page.getByRole('heading', { name: 'Здесь начинается Vault.' })).toBeVisible();
  await page.getByRole('button', { name: 'К калькулятору' }).click();
  await createVault(page);
  await page.getByLabel('Файлы для импорта').setInputFiles({ name: 'private.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
  await page.getByRole('button', { name: 'Переименовать private.txt', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Результат')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
