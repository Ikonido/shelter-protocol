import LZString from 'lz-string';
import { CATEGORIES, type Card, type CardPack, type Category, type Modifier, type Scenario } from '../types';
import { uid } from './rng';
import { LIMITS as L } from './limits';


const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
const MODS: Modifier[] = ['positive', 'neutral', 'negative'];

function sanitizeCard(raw: unknown, category: Category, i: number): Card | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const description = str(r.description, L.cardDescription);
  if (!description) return null;
  const card: Card = { id: str(r.id, 60) || `c${i}-${uid('card')}`, category, description };
  const title = str(r.title, L.cardTitle);
  if (title) card.title = title;
  if (MODS.includes(r.modifier as Modifier)) card.modifier = r.modifier as Modifier;
  const tags = strList(r.tags, L.cardTags, L.tagLen);
  if (tags.length) card.tags = tags;
  return card;
}

export function sanitizeScenario(raw: unknown, i: number): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title, L.scenarioTitle);
  if (!title) return null;
  const slots = Number(r.shelterSlots);
  return {
    id: str(r.id, 60) || `s${i}-${uid('sc')}`,
    title,
    description: str(r.description, L.scenarioDescription),
    shelterSlots: Number.isFinite(slots) ? Math.min(19, Math.max(1, Math.round(slots))) : 4,
    isolationDuration: str(r.isolationDuration, L.scenarioDuration),
    requiredSkills: strList(r.requiredSkills, L.skills, L.skillLen),
    threats: strList(r.threats, L.threats, L.threatLen),
  };
}

/** Любые внешние данные (файл, ссылка, localStorage) проходят через эту функцию: вернёт безопасный CardPack или null. */
export function sanitizePack(raw: unknown): CardPack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, L.packName);
  if (!name) return null;
  const rawCards = (r.cards && typeof r.cards === 'object' ? r.cards : {}) as Record<string, unknown>;
  const cards = Object.fromEntries(
    CATEGORIES.map((cat) => {
      const list = Array.isArray(rawCards[cat]) ? (rawCards[cat] as unknown[]).slice(0, L.cardsPerCategory) : [];
      return [cat, list.map((c, i) => sanitizeCard(c, cat, i)).filter((c): c is Card => !!c)];
    }),
  ) as Record<Category, Card[]>;
  const scenarios = (Array.isArray(r.scenarios) ? (r.scenarios as unknown[]).slice(0, L.scenarios) : [])
    .map(sanitizeScenario)
    .filter((s): s is Scenario => !!s);
  return {
    id: str(r.id, 60) || uid('pack'),
    name,
    description: str(r.description, L.packDescription),
    isCustom: true,
    scenarios,
    cards,
  };
}

export function emptyPack(): CardPack {
  return {
    id: uid('pack'),
    name: 'Новый пак',
    description: '',
    isCustom: true,
    scenarios: [],
    cards: Object.fromEntries(CATEGORIES.map((c) => [c, []])) as unknown as Record<Category, Card[]>,
  };
}

export function clonePack(pack: CardPack, name = `${pack.name} (копия)`): CardPack {
  return { ...(JSON.parse(JSON.stringify(pack)) as CardPack), id: uid('pack'), name, isCustom: true };
}

export function packStats(pack: CardPack) {
  return {
    cards: CATEGORIES.reduce((s, c) => s + pack.cards[c].length, 0),
    scenarios: pack.scenarios.length,
  };
}

/* ---------- Шеринг: JSON → lz-string → #pack=... ---------- */

export function encodePack(pack: CardPack): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(pack));
}

/** Предел длины ссылки: lz-string не умеет ограничивать размер распаковки, а «бомба» из коротких данных раздувается квадратично. */
export const MAX_SHARE_CHARS = 20000;
export const MAX_FILE_BYTES = 500_000;

export function decodePack(encoded: string): CardPack | null {
  if (encoded.length > MAX_SHARE_CHARS) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    return json && json.length <= MAX_FILE_BYTES * 2 ? sanitizePack(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

/** null — пак не помещается в ссылку (используйте файл). */
export function shareUrl(pack: CardPack): string | null {
  const enc = encodePack(pack);
  if (enc.length > MAX_SHARE_CHARS) return null;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#pack=${enc}`;
}

export function packFromHash(hash: string): CardPack | null {
  const m = /^#?pack=(.+)$/.exec(hash);
  return m ? decodePack(m[1]) : null;
}

/* ---------- Файлы: Native File System API с запасным вариантом ---------- */

export async function exportPackFile(pack: CardPack): Promise<void> {
  const text = JSON.stringify({ ...pack, isCustom: undefined }, null, 2);
  const fileName = `${pack.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'pack'}.shelter.json`;
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (t: string) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Shelter pack', accept: { 'application/json': ['.json'] } }],
      });
      const stream = await handle.createWritable();
      await stream.write(text);
      await stream.close();
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}

export async function importPackFile(): Promise<CardPack | null> {
  const w = window as unknown as {
    showOpenFilePicker?: (o: unknown) => Promise<{ getFile: () => Promise<File> }[]>;
  };
  let file: File | null = null;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [{ description: 'Shelter pack', accept: { 'application/json': ['.json'] } }],
      });
      file = await handle.getFile();
    } catch {
      return null;
    }
  } else {
    file = await new Promise<File | null>((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
  if (!file) return null;
  if (file.size > MAX_FILE_BYTES) throw new Error('Файл слишком большой (>500 КБ)');
  try {
    const pack = sanitizePack(JSON.parse(await file.text()));
    if (!pack) throw new Error();
    return pack;
  } catch {
    throw new Error('Не удалось прочитать пак: неверный формат JSON');
  }
}
