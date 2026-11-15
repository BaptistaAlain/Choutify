// État de l'interface : messages, feuilles d'actions, boîtes de dialogue.
import type { ComponentChildren } from 'preact';
import { Observable } from './store';

export interface SheetAction {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

export interface Sheet {
  title?: string;
  subtitle?: string;
  coverId?: string;
  actions?: SheetAction[];
  content?: () => ComponentChildren;
}

export interface Prompt {
  title: string;
  value: string;
  placeholder?: string;
  confirm: string;
  resolve: (v: string | null) => void;
}

export interface Confirm {
  title: string;
  message?: string;
  confirm: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export const ui = new Observable<{
  toast: { id: number; text: string; action?: { label: string; run: () => void } } | null;
  sheet: Sheet | null;
  prompt: Prompt | null;
  confirm: Confirm | null;
  nowPlaying: boolean;
  queue: boolean;
  updateReady: boolean;
}>({ toast: null, sheet: null, prompt: null, confirm: null, nowPlaying: false, queue: false, updateReady: false });

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: { label: string; run: () => void }, ms = 3200) {
  clearTimeout(toastTimer);
  const id = Date.now();
  ui.set({ toast: { id, text, action } });
  toastTimer = setTimeout(() => {
    if (ui.get().toast?.id === id) ui.set({ toast: null });
  }, ms);
}

export function openSheet(sheet: Sheet) {
  ui.set({ sheet });
}
export function closeSheet() {
  ui.set({ sheet: null });
}

export function ask(title: string, value = '', confirm = 'OK', placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => ui.set({ prompt: { title, value, confirm, placeholder, resolve } }));
}

export function confirmDialog(title: string, message?: string, confirm = 'Confirmer', danger = false): Promise<boolean> {
  return new Promise((resolve) => ui.set({ confirm: { title, message, confirm, danger, resolve } }));
}

export function formatDuration(ms?: number) {
  if (!ms || !isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatTotal(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')}`;
}

export function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} Ko`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(0)} Mo`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1).replace('.', ',')} Go`;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}
