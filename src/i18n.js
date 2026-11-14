// Словарь и функция t('ключ'). Тексты в коде не хранятся.

let dict = {};
let currentLang = 'ru';

export async function loadLang(lang = 'ru') {
  // Путь считается от этого файла, поэтому работает и локально, и на GitHub Pages.
  const url = new URL(`../i18n/${lang}.json`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`i18n: не удалось загрузить ${url} (${res.status})`);
  dict = await res.json();
  currentLang = lang;
}

export function getLang() {
  return currentLang;
}

// t('ui.tickCounter', { n: 5 }) -> "Тиков: 5"
// Если ключа нет, возвращает [ключ] и пишет предупреждение в консоль.
export function t(key, params) {
  const str = dict[key];
  if (str === undefined) {
    console.warn(`i18n: нет ключа "${key}"`);
    return `[${key}]`;
  }
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m
  );
}
