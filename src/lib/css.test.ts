import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('animations', () => {
  const css = readFileSync('src/index.css', 'utf8');
  // Если анимация появления оставляет transform после конца (fill both/forwards), обёртка экрана становится
  // «содержащим блоком» для position:fixed, и окна оказываются внизу длинной страницы, за пределами экрана.
  it('the screen wrapper animation leaves no transform behind', () => {
    const line = css.split('\n').find((l) => l.includes('--animate-rise:'))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\b(both|forwards)\b/);
  });
});
