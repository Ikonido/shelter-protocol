import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const KEY = 'shelter:tourDone';
export const tourSeen = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // без хранилища не навязываем обучение при каждом запуске
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ок */
  }
};

export const TOUR: { title: string; text: string; points?: string[] }[] = [
  { title: 'Мест на всех не хватит', text: 'Случилась катастрофа, и бункер вмещает не всех. Вы вместе решаете, кто войдёт внутрь, а кто останется снаружи. Убежище должно пережить изоляцию.' },
  {
    title: 'У каждого девять карт',
    text: 'Сначала их видите только вы. Каждая карта открывается остальным по вашему желанию.',
    points: ['Профессия, биология (пол, возраст, раса)', 'Телосложение и характер', 'Здоровье, хобби, багаж, факт', 'Одноразовое действие'],
  },
  {
    title: 'Как идёт раунд',
    text: 'Игроки по очереди открывают по карте и объясняют, чем полезны убежищу. После нескольких вскрытий голосование: кого не берём. Можно воздержаться: если воздержится больше половины, никто не уходит.',
  },
  {
    title: 'Навыки и угрозы',
    text: 'У сценария есть нужные навыки и угрозы (крысы, течь, мародёры). Карты с подходящим навыком закрывают угрозы. Болезни ослабляют колонию, врач смягчает тяжёлые случаи.',
  },
  {
    title: 'Как выиграть',
    text: 'В финале приложение сверит оставшихся с требованиями сценария и покажет хронику изоляции. Победа, если закрыты нужные навыки и угрозы, а убежище не переполнено.',
    points: ['«Быстрая игра» запускается в одно касание', 'Онлайн-комната: код или QR для друзей', 'Тема, звук и размер текста: «Настройки»'],
  },
];

/** Короткое обучение в пять экранов: открывается при первом запуске и по кнопке в «Правилах». */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = TOUR[i];
  const last = i === TOUR.length - 1;
  const close = () => {
    markSeen();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Обучение">
      <div className="panel hud anim-rise flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-b-none sm:rounded-b-lg">
        <div className="flex items-center justify-between">
          <span className="chip">{i + 1} из {TOUR.length}</span>
          <button className="btn btn-sm" onClick={close} aria-label="Пропустить обучение"><X size={14} /> Пропустить</button>
        </div>
        <h2 className="text-lg font-bold uppercase tracking-wider text-amber">{step.title}</h2>
        <p className="text-sm leading-relaxed">{step.text}</p>
        {step.points && <ul className="flex flex-col gap-1 text-sm text-dim">{step.points.map((p) => <li key={p}>• {p}</li>)}</ul>}
        <div className="flex justify-center gap-1.5" aria-hidden>
          {TOUR.map((_, k) => <span key={k} className={`h-1.5 w-6 rounded ${k === i ? 'bg-amber' : 'bg-edge'}`} />)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={16} /> Назад</button>
          {last ? (
            <button className="btn btn-primary" onClick={close}>Понятно, играем</button>
          ) : (
            <button className="btn btn-primary" onClick={() => setI(i + 1)}>Дальше <ChevronRight size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}
