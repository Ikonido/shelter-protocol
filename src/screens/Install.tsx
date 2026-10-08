import { ArrowLeft, Download, MoreVertical, Share } from 'lucide-react';
import { useStore } from '../store';
import { useInstall } from '../lib/pwa';
import { QR } from '../ui/QR';
import { copyText } from '../ui/clipboard';
import { t } from '../lib/i18n';

export default function Install() {
  const { go, notify } = useStore();
  const { canPrompt, standalone, ios, install } = useInstall();
  const url = location.origin + location.pathname;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const secure = window.isSecureContext;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> {t('Назад')}</button>
      <h1 className="h-hud text-base">{t('Установить на телефон')}</h1>

      {standalone ? (
        <p className="panel text-sm text-ok">{t('Приложение уже установлено и запущено как приложение.')}</p>
      ) : (
        <>
          {canPrompt && (
            <button className="btn btn-primary" onClick={async () => notify((await install()) ? t('Приложение установлено') : t('Установка отменена'))}>
              <Download size={18} /> {t('Установить приложение')}
            </button>
          )}
          <section className="panel flex flex-col gap-3 text-sm">
            <h2 className="label">{t('Как установить')}</h2>
            <p><b className="text-amber">Android (Chrome):</b> {t('меню')} <MoreVertical className="inline" size={14} /> {t('→ «Установить приложение» (или «Добавить на главный экран»).')}</p>
            <p><b className="text-amber">iPhone / iPad (Safari):</b> {t('кнопка «Поделиться»')} <Share className="inline" size={14} /> {t('→ «На экран “Домой”».')}</p>
            {ios && <p className="text-xs text-dim">{t('На iOS установка работает только из Safari.')}</p>}
            <p className="text-xs text-dim">{t('Это не магазинное приложение, а установка прямо из браузера: бесплатно, без регистрации, обновляется само. После первого запуска игра работает без интернета (онлайн-комнаты, конечно, требуют сети).')}</p>
            {!secure && <p className="text-xs text-danger">{t('Страница открыта не по https — офлайн-режим и полноценная установка недоступны. Для LAN-режима это нормально.')}</p>}
          </section>
          <section className="panel text-center">
            <h2 className="label">{t('Откройте на телефоне')}</h2>
            {local ? (
              <p className="text-xs text-danger">{t('Адрес localhost недоступен с других устройств. Откройте приложение по его публичному/LAN-адресу, чтобы получить рабочий QR.')}</p>
            ) : (
              <>
                <QR value={url} size={192} label={t('QR-код со ссылкой на приложение')} />
                <p className="mt-2 break-all text-xs text-dim">{url}</p>
                <button className="btn btn-sm mt-2" onClick={async () => notify((await copyText(url)) ? t('Ссылка скопирована') : t('Не удалось скопировать'))}>{t('Копировать ссылку')}</button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
