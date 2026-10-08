import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { buildCsp } from './src/lib/csp';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Content-Security-Policy production-сборки (в dev HMR требует inline-скриптов, поэтому только build). Политика собирается в src/lib/csp.ts. */
function csp(env: Record<string, string>): Plugin {
  const policy = buildCsp(env);
  return {
    name: 'shelter-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />`,
      ),
  };
}

/**
 * Версия сборки: в CI — короткий SHA коммита, локально — метка времени. Одно значение попадает и в код приложения
 * (__APP_VERSION__), и в файл version.json рядом с сайтом: по их сравнению приложение понимает, что вышла новая версия.
 */
const BUILD = {
  id: (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 7),
  builtAt: new Date().toISOString(),
};

function versionFile(): Plugin {
  return {
    name: 'shelter-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
  };
}

/**
 * Офлайн-кеш service worker'а: после сборки в dist/sw.js подставляются список собранных JS/CSS и id сборки.
 * Без этого первая установка кеширует только оболочку (HTML, иконки), а код приложения не попадает в кеш.
 */
function precacheAssets(): Plugin {
  let outDir = '';
  const files: string[] = [];
  return {
    name: 'shelter-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) if (/\.(js|css)$/.test(name)) files.push(`./${name}`);
    },
    closeBundle() {
      const sw = resolve(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('/*__PRECACHE__*/[]', JSON.stringify(files)).replace('__BUILD__', BUILD.id));
    },
  };
}

// base './' keeps the build portable: GitHub Pages sub-path, Cloudflare Pages, Vercel, LAN server.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(mode === 'production' ? BUILD : { id: 'dev', builtAt: BUILD.builtAt }) },
  plugins: [react(), tailwindcss(), csp(loadEnv(mode, process.cwd(), 'VITE_')), versionFile(), precacheAssets()],
  test: { environment: 'node' },
}));
