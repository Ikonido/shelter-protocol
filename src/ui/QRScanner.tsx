import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { parseInvite, type Invite } from '../lib/invite';
import { t } from '../lib/i18n';

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** Сканер QR с камеры. Видео обрабатывается только на устройстве и никуда не отправляется. */
export function QRScanner({ onInvite, onClose }: { onInvite: (i: Invite) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [foreign, setForeign] = useState(false);
  // Родитель передаёт новую функцию при каждой перерисовке. Держим последнюю в ref, а не в зависимостях эффекта,
  // иначе камера перезапускалась бы на каждом обновлении экрана.
  const inviteRef = useRef(onInvite);
  useEffect(() => {
    inviteRef.current = onInvite;
  }, [onInvite]);

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let timer = 0;

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(t('Камера доступна только на https-страницах (в LAN по http она заблокирована браузером). Введите код вручную.'));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setError(t('Нет доступа к камере. Разрешите её в настройках браузера или введите код вручную.'));
        return;
      }
      if (stop) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => undefined);

      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = BD ? new BD({ formats: ['qr_code'] }) : null;
      const jsQR = native ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        if (stop) return;
        if (v.readyState >= 2 && v.videoWidth) {
          let text: string | null = null;
          try {
            if (native) {
              text = (await native.detect(v))[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              const w = Math.min(640, v.videoWidth);
              canvas.width = w;
              canvas.height = Math.round((v.videoHeight * w) / v.videoWidth);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              text = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data ?? null;
            }
          } catch {
            /* кадр не распознан — пробуем следующий */
          }
          if (text) {
            const invite = parseInvite(text);
            if (invite) return inviteRef.current(invite);
            setForeign(true);
          }
        }
        timer = window.setTimeout(tick, 200);
      };
      void tick();
    })();

    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-md border border-edge bg-bg">
          <video ref={video} className="aspect-square w-full object-cover" muted playsInline aria-label={t('Камера для сканирования QR-кода')} />
          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-amber/70" />
        </div>
      )}
      {foreign && !error && <p className="text-xs text-amber">{t('Это не QR-код приглашения. Наведите на код из комнаты.')}</p>}
      <button className="btn btn-sm" onClick={onClose}><X size={14} /> {t('Закрыть камеру')}</button>
    </div>
  );
}

