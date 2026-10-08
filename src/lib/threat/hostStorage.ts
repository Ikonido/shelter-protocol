import { OnlineHost, type HostCheckpoint, type HostSetup } from '../online';
import { validateSavedGame } from '../storage';
import { t } from '../i18n';
const KEY = 'shelter:hiddenThreatHost:v1';
export interface HostedRoom { code: string; checkpoint: HostCheckpoint; setup: HostSetup }
/** An explicit resume request can never fall back to allocating a fresh lobby/role assignment. */
export function openLobbySession(setup: HostSetup, name: string, resume: boolean): { host: OnlineHost; code?: string } {
  if (!resume) return { host: new OnlineHost(setup, name) };
  const saved = loadHostedRoom();
  const host = saved && OnlineHost.restore(saved.checkpoint, saved.setup);
  if (!saved || !host) throw new Error(t('Сохранённая комната отсутствует или повреждена. Восстановление отменено.'));
  return { host, code: saved.code };
}
export function loadHostedRoom(): HostedRoom | null {
  try {
    const value = localStorage.getItem(KEY);
    if (!value) return null;
    const raw = JSON.parse(value);
    const g = validateSavedGame(raw.checkpoint?.game);
    if (!g?.hiddenThreat || g.config.mode !== 'online' || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(raw.code)) return null;
    const setup: HostSetup = { scenario: g.scenario, packs: [], slots: g.config.shelterSlots, voting: g.config.voting, variant: 'hidden-threat', hiddenThreat: g.config.hiddenThreat };
    const host = OnlineHost.restore(raw.checkpoint, setup);
    return host ? { code: raw.code, checkpoint: host.checkpoint()!, setup } : null;
  } catch { return null; }
}
export function saveHostedRoom(code: string, host: OnlineHost): void {
  const checkpoint = host.checkpoint();
  if (!checkpoint) return;
  try { localStorage.setItem(KEY, JSON.stringify({ code, checkpoint })); } catch { /* The live authority remains usable. */ }
}
export function clearHostedRoom(): void { try { localStorage.removeItem(KEY); } catch { /* optional */ } }
