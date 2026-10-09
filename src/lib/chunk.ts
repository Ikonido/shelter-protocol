/**
 * Нарезка больших сообщений для канала PeerJS.
 *
 * Канал в режиме json отвергает любое сообщение от 16300 байт (событие message-too-big), а русский текст занимает по 2 байта на
 * символ: вид партии на 6–10 игроков перерастает лимит уже в первых раундах. Поэтому всё, что не помещается, режется на части
 * и собирается на другой стороне. Каналы упорядочены, так что части приходят подряд.
 *
 * Принимающая сторона не доверяет отправителю: число и размер частей ограничены, одновременно собирается одно сообщение,
 * нарушение порядка сбрасывает сборку.
 */

/** С какого размера (байт в UTF-8) сообщение режется. Запас от лимита 16300 на обёртку и служебные поля. */
export const CHUNK_AT_BYTES = 12_000;
/** Длина одной части в символах UTF-16: до 3 байт на символ, то есть не больше 12 000 байт на часть. */
export const PIECE_CHARS = 4_000;
/** Больше частей не принимаем: около 320 тысяч символов, с большим запасом выше любого вида партии. */
export const MAX_PIECES = 80;

interface Piece {
  __chunk: 1;
  id: number;
  i: number;
  n: number;
  d: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

const isPiece = (v: unknown): v is Piece => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return p.__chunk === 1 && isInt(p.id) && isInt(p.i) && isInt(p.n) && typeof p.d === 'string';
};

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Что отправлять в канал: само сообщение или, если оно велико, список частей. */
export function toPieces(message: unknown, id: number): unknown[] {
  const text = JSON.stringify(message);
  if (text === undefined || byteLength(text) < CHUNK_AT_BYTES) return [message];
  const n = Math.ceil(text.length / PIECE_CHARS);
  return Array.from({ length: n }, (_, i): Piece => ({ __chunk: 1, id, i, n, d: text.slice(i * PIECE_CHARS, (i + 1) * PIECE_CHARS) }));
}

/**
 * Сборщик входящих сообщений одного соединения. Для обычного сообщения возвращает его же, для части — собранное целиком,
 * когда пришла последняя часть, иначе undefined (часть учтена или отброшена).
 */
export function createAssembler(): (raw: unknown) => unknown {
  let cur: { id: number; n: number; got: number; parts: string[] } | null = null;
  return (raw) => {
    // Объект, помеченный как часть, но с неверными полями, отбрасывается: дальше он не пройдёт как обычное сообщение.
    if (raw && typeof raw === 'object' && '__chunk' in raw && !isPiece(raw)) return undefined;
    if (!isPiece(raw)) return raw;
    const { id, i, n, d } = raw;
    if (n < 2 || n > MAX_PIECES || i < 0 || i >= n || d.length > PIECE_CHARS) {
      cur = null;
      return undefined;
    }
    if (i === 0) cur = { id, n, got: 0, parts: [] };
    if (!cur || cur.id !== id || cur.n !== n || cur.got !== i) {
      cur = null;
      return undefined;
    }
    cur.parts.push(d);
    cur.got++;
    if (cur.got < cur.n) return undefined;
    const text = cur.parts.join('');
    cur = null;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
}
