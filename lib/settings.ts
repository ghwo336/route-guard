import type { Mode } from '@/core/types';

export const SETTINGS_KEY = 'settings';
export type Settings = { mode: Mode };
export const DEFAULT_SETTINGS: Settings = { mode: 'scoped' };

export async function getSettings(): Promise<Settings> {
  const got = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
    Partial<Settings> | undefined;
  const mode = got?.mode === 'global' ? 'global' : 'scoped';
  return { mode };
}

export async function setSettings(s: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: s });
}
