import { useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { t } from '../lib/i18n';

/** Экран-«шторка»: защищает приватные данные при передаче устройства по кругу. */
export function Gate({ name, children }: { name: string; children: ReactNode }) {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    const hide = () => setOwner(null);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', hide); };
  }, []);
  if (owner === name) return <>{children}</>;
  return (
    <div className="panel flex flex-col items-center gap-4 py-10 text-center">
      <Lock className="text-amber" size={40} />
      <p className="text-sm text-dim">{t('Передайте устройство игроку')}</p>
      <p className="text-2xl font-bold text-amber">{name}</p>
      <button className="btn btn-primary" onClick={() => setOwner(name)}>{t('Это я — показать')}</button>
    </div>
  );
}
