import type { OnlineDraft } from '../../store';
import { OnlineHost, type HostCheckpoint } from '../online';
import { isValidCode, type NetMode } from '../net';

const KEY = 'shelter:hiddenRoom:v1';
export interface SavedHiddenRoom {
  version: 1;
  code: string;
  net: NetMode;
  checkpoint: HostCheckpoint;
}
export function saveHiddenRoom(
  host: OnlineHost,
  code: string,
  net: NetMode,
): void {
  const checkpoint = host.checkpoint();
  if (!checkpoint) return;
  localStorage.setItem(
    KEY,
    JSON.stringify({ version: 1, code, net, checkpoint }),
  );
}
export function loadHiddenRoom(): SavedHiddenRoom | null {
  try {
    const r = JSON.parse(
      localStorage.getItem(KEY) ?? 'null',
    ) as SavedHiddenRoom | null;
    if (
      !r ||
      r.version !== 1 ||
      !isValidCode(r.code) ||
      !['lan', 'internet'].includes(r.net) ||
      !OnlineHost.restoreCheckpoint(r.checkpoint)
    )
      return null;
    return r;
  } catch {
    return null;
  }
}
export function hiddenRoomDraft(room: SavedHiddenRoom): OnlineDraft {
  const g = room.checkpoint.game,
    c = g.config;
  return {
    scenario: g.scenario,
    packs: [],
    slots: c.shelterSlots,
    voting: c.voting,
    revealsPerVote: c.revealsPerVote,
    speechSec: c.speechSec,
    hazardCount: c.hazardCount,
    difficulty: c.difficulty,
    roundEvents: c.roundEvents,
    autoActions: c.autoActions,
    professionPerks: c.professionPerks,
    timeLimitMin: c.timeLimitMin,
    hiddenThreat: c.hiddenThreat,
    resume: true,
  };
}
