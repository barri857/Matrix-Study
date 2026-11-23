'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Language = 'en' | 'ru' | 'kk';
export type TranslationDictionary = { ru: Record<string, string>; kk: Record<string, string> };
export type TranslationVariables = Record<string, string | number>;
export type Translator = (text: string, variables?: TranslationVariables) => string;

const STORAGE_KEY = 'matrix-language';
const listeners = new Set<() => void>();
let language: Language = 'en';
let initialized = false;

const common: TranslationDictionary = {
  ru: { 'Interface language': 'Язык интерфейса', Cancel: 'Отмена', Close: 'Закрыть', Save: 'Сохранить', Remove: 'Удалить', 'Please wait…': 'Подождите…' },
  kk: { 'Interface language': 'Интерфейс тілі', Cancel: 'Болдырмау', Close: 'Жабу', Save: 'Сақтау', Remove: 'Жою', 'Please wait…': 'Күте тұрыңыз…' },
};

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'ru' || value === 'kk';
}

export function getLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  if (!initialized) {
    initialized = true;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLanguage(saved)) language = saved;
    } catch { /* This session still supports switching if browser storage is unavailable. */ }
  }
  return language;
}

function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = getLanguage();
}

export function setLanguage(next: Language) {
  if (!isLanguage(next) || typeof window === 'undefined') return;
  getLanguage();
  const changed = next !== language;
  language = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the session choice. */ }
  applyDocumentLanguage();
  if (changed) listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const next = isLanguage(event.newValue) ? event.newValue : 'en';
  if (next === language) return;
  language = next;
  applyDocumentLanguage();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  applyDocumentLanguage();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** UI strings only: never pass notes, imported documents, or other user content here. */
export function translate(locale: Language, text: string, variables?: TranslationVariables, dictionary?: TranslationDictionary): string {
  const translated = locale === 'en' ? text : dictionary?.[locale]?.[text] ?? common[locale][text] ?? text;
  if (!variables) return translated;
  return translated.replace(/\{([\w]+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : placeholder);
}

/** For event handlers outside components; React UI should use the subscribing hook. */
export function t(text: string, variables?: TranslationVariables, dictionary?: TranslationDictionary): string {
  return translate(getLanguage(), text, variables, dictionary);
}

export function useLanguage(dictionary?: TranslationDictionary) {
  const locale = useSyncExternalStore(subscribe, getLanguage, () => 'en' as Language);
  const translateText: Translator = useCallback((text, variables) => translate(locale, text, variables, dictionary), [locale, dictionary]);
  return { language: locale, setLanguage, t: translateText };
}
