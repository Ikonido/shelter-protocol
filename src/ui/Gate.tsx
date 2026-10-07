import { useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';

/** Экран-«шторка»: защищает приватные данные при передаче устройства по кругу. */
export function Gate({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <div className="panel flex flex-col items-center gap-4 py-10 text-center">
      <Lock className="text-amber" size={40} />
      <p className="text-sm text-dim">Передайте устройство игроку</p>
      <p className="text-2xl font-bold text-amber">{name}</p>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>Это я — показать</button>
    </div>
  );
}
