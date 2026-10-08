import { OnlineHost, type HostCheckpoint, type HostSetup } from '../online';
import { validateSavedGame } from '../storage';
const KEY = 'shelter:hiddenThreatHost:v1';
export interface HostedRoom { code: string; checkpoint: HostCheckpoint; setup: HostSetup }
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
