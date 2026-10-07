import type { GameState } from '../types';
import { evaluate } from './evaluate';
import { rulesFor } from './difficulty';

export interface ResultCard {
  scenario: string;
  headline: string;
  verdict: 'survived' | 'fragile' | 'failed';
  score: number;
  difficulty: string;
  survivors: string[];
  threats: { title: string; ok: boolean }[];
  notes: string[];
}

/** Данные для картинки с итогом (без скрытой информации: только имена выживших, угрозы и счёт). */
export function resultCard(game: GameState): ResultCard {
  const survivors = game.players.filter((p) => !p.isEliminated);
  const ev = evaluate(game.scenario, survivors, game.config.shelterSlots, game.hazards ?? [], game.config.difficulty);
  return {
    scenario: game.scenario.title,
    headline: ev.headline,
    verdict: ev.verdict,
    score: ev.score,
    difficulty: rulesFor(game.config.difficulty).label,
    survivors: survivors.map((p) => p.name),
    threats: ev.hazards.map((h) => ({ title: h.hazard.title, ok: h.ok })),
    notes: ev.notes.slice(0, 4),
  };
}

/** Переносит текст по словам в заданную ширину (меряет сам холст). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Рисует карточку итога 1080 px в ширину; высота зависит от содержимого. */
export function renderResult(card: ResultCard): HTMLCanvasElement {
  const W = 1080;
  const pad = 64;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  measure.font = '30px ui-monospace, Menlo, Consolas, monospace';
  const survivorLines = wrap(measure, card.survivors.join(' · ') || 'никого', W - pad * 2);
  const noteLines = card.notes.flatMap((n) => wrap(measure, `• ${n}`, W - pad * 2));
  const H = 520 + survivorLines.length * 44 + card.threats.slice(0, 8).length * 42 + noteLines.length * 40 + 90;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const tone = card.verdict === 'survived' ? '#4ade80' : card.verdict === 'fragile' ? '#fbbf24' : '#f87171';
  ctx.fillStyle = '#060a09';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = tone;
  ctx.lineWidth = 6;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  const mono = (px: number, bold = false) => (ctx.font = `${bold ? 'bold ' : ''}${px}px ui-monospace, Menlo, Consolas, monospace`);
  let y = 110;
  ctx.fillStyle = '#75998c';
  mono(26);
  ctx.fillText('ПРОТОКОЛ «УБЕЖИЩЕ»', pad, y);
  y += 60;
  ctx.fillStyle = '#d3ebe2';
  mono(44, true);
  wrap(ctx, card.scenario.toUpperCase(), W - pad * 2).forEach((l) => { ctx.fillText(l, pad, y); y += 54; });
  y += 10;
  ctx.fillStyle = tone;
  mono(40, true);
  wrap(ctx, card.headline, W - pad * 2 - 220).forEach((l) => { ctx.fillText(l, pad, y); y += 50; });
  // Счёт
  ctx.textAlign = 'right';
  mono(110, true);
  ctx.fillText(String(card.score), W - pad, 250);
  ctx.textAlign = 'left';
  y += 20;
  ctx.fillStyle = '#75998c';
  mono(26);
  ctx.fillText(`${card.difficulty.toUpperCase()} СЛОЖНОСТЬ`, pad, y);
  y += 60;
  ctx.fillStyle = '#fbbf24';
  mono(28, true);
  ctx.fillText(`ВЫЖИЛИ (${card.survivors.length})`, pad, y);
  y += 46;
  ctx.fillStyle = '#d3ebe2';
  mono(30);
  survivorLines.forEach((l) => { ctx.fillText(l, pad, y); y += 44; });
  if (card.threats.length) {
    y += 20;
    ctx.fillStyle = '#fbbf24';
    mono(28, true);
    ctx.fillText('УГРОЗЫ', pad, y);
    y += 46;
    mono(30);
    card.threats.slice(0, 8).forEach((t) => {
      ctx.fillStyle = t.ok ? '#4ade80' : '#f87171';
      ctx.fillText(`${t.ok ? '✔' : '✘'} ${t.title}`, pad, y);
      y += 42;
    });
  }
  if (noteLines.length) {
    y += 20;
    ctx.fillStyle = '#f87171';
    mono(28);
    noteLines.forEach((l) => { ctx.fillText(l, pad, y); y += 40; });
  }
  return canvas;
}

/** Делится картинкой (Web Share, если умеет) или скачивает файл. Возвращает, что получилось. */
export async function shareResultImage(card: ResultCard): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    const canvas = renderResult(card);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return 'failed';
    const file = new File([blob], 'shelter-result.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'Протокол «Убежище»', text: `${card.scenario}: ${card.headline}` });
        return 'shared';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'shared'; // человек закрыл окно — не ошибка
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shelter-result.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
