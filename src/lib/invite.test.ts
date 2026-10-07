import { describe, expect, it } from 'vitest';
import { parseInvite } from './invite';

describe('parseInvite', () => {
  it('ссылка с кодом и билетом', () => {
    expect(parseInvite('https://ikonido.github.io/shelter-protocol/#join=K7P2M.ABCDEF')).toEqual({ code: 'K7P2M', ticket: 'ABCDEF' });
  });
  it('ссылка только с кодом и голый код (регистр не важен)', () => {
    expect(parseInvite('http://192.168.1.23:8080/#join=k7p2m')).toEqual({ code: 'K7P2M' });
    expect(parseInvite('k7p2m')).toEqual({ code: 'K7P2M' });
  });
  it('чужие QR-коды и мусор отклоняются', () => {
    for (const s of ['https://example.com', 'WIFI:S:net;T:WPA;P:pass;;', '', 'ABC', '#join=!!!!!']) expect(parseInvite(s)).toBeNull();
  });
  it('символы вне алфавита кодов (0/O, 1/I) отклоняются', () => {
    expect(parseInvite('#join=00000')).toBeNull();
  });
});
