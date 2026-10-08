import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import { StoreProvider, useStore } from '../../store';
import Game from '../../screens/Game';
import { PrivateAccess } from '../../ui/HiddenThreatPrivate';
import { ThreatFinalReport } from '../../ui/HiddenThreatPublic';
import { beginSecretRound } from './engine';
import { game } from './fixtures';
import { saveGame } from '../storage';
import { updateSettings } from '../settings';
import { t } from '../i18n';
import { DICTS } from '../../i18n';
import {
  DIRECTION_LABEL,
  EVIDENCE_LABEL,
  RESULT_LABEL,
  ROLE_LABEL,
} from './types';

let dom: JSDOM, root: Root;
beforeEach(async () => {
  dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://example.com/shelter/' },
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    history: dom.window.history,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(key, value);
  updateSettings({ lang: 'ru' });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => {
  await act(async () => root.render(node));
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error('Missing button: ' + label);
  await act(async () =>
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
  );
};

describe('private screens and full local game UI', () => {
  it('advances expired speech timers in managed tabletop games', async () => {
    vi.useFakeTimers();
    try {
      const g = game();
      g.config.mode = 'tabletop';
      g.config.speechSec = 20;
      g.phase = 'speech';
      g.speechEndsAt = Date.now() - 1;
      g.revealedThisRound = ['p1'];
      g.lastReveal = { playerId: 'p1', category: 'biology' };
      saveGame(g);
      let store: ReturnType<typeof useStore> | undefined;
      function Probe() {
        store = useStore();
        return null;
      }
      await render(
        createElement(
          StoreProvider,
          null,
          createElement(Game),
          createElement(Probe),
        ),
      );
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(store!.game!.phase).toBe('reveal');
      expect(document.body.textContent).not.toContain('Маньяк');
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not mount private content before confirmation and locks on blur, visibility change and owner switch', async () => {
    const privateRender = vi.fn(() =>
      createElement('p', null, 'OWNER-ONE-SECRET'),
    );
    await render(
      createElement(PrivateAccess, {
        key: 'p1',
        name: 'One',
        render: privateRender,
      }),
    );
    expect(privateRender).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('OWNER-ONE-SECRET');
    await click('Это я — показать');
    expect(document.body.textContent).toContain('OWNER-ONE-SECRET');
    await act(async () => window.dispatchEvent(new dom.window.Event('blur')));
    expect(document.body.textContent).not.toContain('OWNER-ONE-SECRET');
    await click('Это я — показать');
    await act(async () =>
      document.dispatchEvent(new dom.window.Event('visibilitychange')),
    );
    expect(document.body.textContent).not.toContain('OWNER-ONE-SECRET');
    await click('Это я — показать');
    await render(
      createElement(PrivateAccess, {
        key: 'p2',
        name: 'Two',
        render: () => createElement('p', null, 'OWNER-TWO-SECRET'),
      }),
    );
    expect(document.body.textContent).not.toContain('OWNER-ONE-SECRET');
    expect(document.body.textContent).not.toContain('OWNER-TWO-SECRET');
  });
  it('collects all local commitments through real StoreProvider/Game without carrying the previous unlocked role', async () => {
    saveGame(beginSecretRound(game()));
    let store: ReturnType<typeof useStore> | undefined;
    function Probe() {
      store = useStore();
      return null;
    }
    await render(
      createElement(
        StoreProvider,
        null,
        createElement(Game),
        createElement(Probe),
      ),
    );
    expect(document.body.textContent).not.toContain('Маньяк');
    expect(document.body.textContent).not.toContain('Полицейский');
    await click('Это я — показать');
    expect(document.body.textContent).toContain('Маньяк');
    await click('Подтвердить и скрыть');
    expect(store!.game!.hiddenThreat!.pending['p1'].operation.kind).toBe(
      'pass',
    );
    expect(document.body.textContent).not.toContain('Маньяк');
    expect(document.body.textContent).not.toContain('Полицейский');
    await click('Это я — показать');
    expect(document.body.textContent).toContain('Полицейский');
    await click('Подтвердить и скрыть');
    expect(document.body.textContent).not.toContain('Полицейский');
    for (let i = 0; i < 2; i++) {
      await click('Это я — показать');
      await click('Подтвердить и скрыть');
    }
    expect(store!.game!.phase).toBe('discussion');
    await click('Открыть материалы для обсуждения');
    await click('Обсуждение закончено — голосовать');
    expect(store!.game!.phase).toBe('vote');
  });
  it('does not display or print secret roles when generating tabletop ordinary cards', async () => {
    const g = game();
    g.config.mode = 'tabletop';
    for (const p of g.players)
      for (const slot of Object.values(p.slots)) {
        slot.card.description = 'ORDINARY-CARD';
        delete slot.card.title;
      }
    saveGame(g);
    await render(createElement(StoreProvider, null, createElement(Game)));
    const printed = [...document.querySelectorAll('div')].find(
      (el) => el.className === 'hidden print:block',
    )!;
    expect(printed.textContent).toContain('ORDINARY-CARD');
    expect(printed.textContent).not.toContain('Маньяк');
    expect(printed.textContent).not.toContain('Полицейский');
    expect(document.body.textContent).toContain(
      'Печать обычных карточек без тайных ролей',
    );
  });
  it('refuses a pre-final declassification preview and allows it only in the final state', async () => {
    const g = game();
    await render(createElement(ThreatFinalReport, { game: g }));
    expect(document.body.textContent).toBe('');
    await render(
      createElement(ThreatFinalReport, { game: { ...g, phase: 'final' } }),
    );
    expect(document.body.textContent).toContain('Рассекреченные материалы');
    expect(document.body.textContent).toContain('Маньяк');
  });
  it('translates every role, investigation, result and evidence label in all supported languages', () => {
    const keys = [
      ...Object.values(ROLE_LABEL),
      ...Object.values(DIRECTION_LABEL),
      ...Object.values(RESULT_LABEL),
      ...Object.values(EVIDENCE_LABEL),
      'Скрытая угроза',
      'Секретный выбор',
      'Рассекреченные материалы',
    ];
    for (const lang of ['uk', 'en', 'de'] as const) {
      updateSettings({ lang });
      for (const key of keys) {
        expect(DICTS[lang][key], lang + ': ' + key).toBeTruthy();
        expect(t(key)).not.toBe(key);
      }
    }
  });
});
