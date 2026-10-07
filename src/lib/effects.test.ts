import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

/**
 * Эффект React не должен возвращать ничего, кроме функции очистки. Браузеры, у которых window.scrollTo и подобные
 * возвращают не undefined, роняют приложение на первой же навигации («x is not a function»), поэтому выражение в
 * стрелке без фигурных скобок допустимо только в трёх безопасных формах.
 */
describe('useEffect hygiene', () => {
  it('expression-bodied effects return only cleanup functions, void, or a subscription', () => {
    const bad: string[] = [];
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/useEffect\(\(\) =>\s*([^\n]{0,80})/g)) {
        const body = m[1];
        const ok = body.startsWith('{') || body.startsWith('() =>') || body.startsWith('void ') || body.startsWith('obj?.subscribe(');
        if (!ok) bad.push(`${f}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
