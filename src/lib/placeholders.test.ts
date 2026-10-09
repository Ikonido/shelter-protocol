import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlaceholder, itemsOf, PLACEHOLDER_ID_LIST } from './inventory';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('empty-bag placeholders', () => {
  it('every placeholder id used in the source is registered (a new one would silently count as a real item)', () => {
    const files = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/id:\s*['"`]((?:lost|stolen)-[\w-]+)['"`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(2);
    for (const id of used) expect(PLACEHOLDER_ID_LIST, `id заглушки «${id}» не внесён в PLACEHOLDER_IDS`).toContain(id);
  });

  it('only the exact placeholder ids are empty; a custom card named like one is an ordinary item', () => {
    const card = (id: string) => ({ id, category: 'luggage' as const, description: 'Вещь', tags: ['ремонт'] });
    for (const id of PLACEHOLDER_ID_LIST) expect(itemsOf(card(id)), id).toEqual([]);
    for (const id of ['lost-keys', 'stolen-goods', 'empty-box', 'lost-', 'lost-luggage-2']) expect(itemsOf(card(id)), id).toHaveLength(1);
  });

  it('a card without a string id does not crash the check', () => {
    expect(() => isPlaceholder({ category: 'luggage', description: 'x' } as never)).not.toThrow();
  });
});
