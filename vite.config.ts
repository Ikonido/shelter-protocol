import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Content-Security-Policy для production-сборки (в dev HMR требует inline-скриптов, поэтому только build).
 * connect-src: сам сайт (LAN-брокер на том же адресе) + брокер PeerJS (публичный или свой из VITE_PEER_HOST).
 * WebRTC-каналы CSP не регулирует, но весь остальной сетевой доступ страницы ограничен списком ниже.
 */
function csp(env: Record<string, string>): Plugin {
  const broker = env.VITE_PEER_HOST || '0.peerjs.com';
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // inline-атрибуты style у React (ширины индикаторов)
    "img-src 'self' data:",
    `connect-src 'self' https://${broker} wss://${broker} ${env.VITE_PEER_SECURE === 'false' ? `http://${broker}:* ws://${broker}:*` : ''}`.trim(),
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
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

// base './' keeps the build portable: GitHub Pages sub-path, Cloudflare Pages, Vercel, LAN server.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), csp(loadEnv(mode, process.cwd(), 'VITE_'))],
  test: { environment: 'node' },
}));
