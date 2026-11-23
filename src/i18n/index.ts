import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { en, TranslationKeys } from "./en";
import { it } from "./it";

export type Lang = "it" | "en";

const STORAGE_KEY = "mtb_lang";

const dictionaries: Record<Lang, TranslationKeys> = { it, en };

let currentLang: Lang = "it";
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function t(key: keyof TranslationKeys, params?: Record<string, string | number>): string {
  let text: string = dictionaries[currentLang][key] ?? dictionaries.en[key] ?? String(key);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
  }
  return text;
}

export async function setLang(lang: Lang) {
  currentLang = lang;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {}
  listeners.forEach((l) => l());
}

export async function initLang() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === "it" || saved === "en") {
      currentLang = saved;
    }
  } catch {}
}

export function useI18n() {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((x) => x + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const changeLang = useCallback(async (lang: Lang) => {
    await setLang(lang);
  }, []);

  return {
    lang: currentLang,
    t,
    setLang: changeLang,
  };
}
