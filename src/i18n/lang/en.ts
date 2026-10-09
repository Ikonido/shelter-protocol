import type { Dictionary } from '../registry';

/** Все части словаря языка «en» одним чанком: подгружается только когда этот язык выбран. */
const parts = import.meta.glob<{ default: Dictionary }>('../dict/en/*.ts', { eager: true });
export default Object.assign({}, ...Object.values(parts).map((m) => m.default)) as Dictionary;
