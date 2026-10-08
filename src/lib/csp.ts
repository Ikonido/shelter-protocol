/**
 * Content-Security-Policy production-сборки. Адреса брокера PeerJS берутся из тех же переменных, что и параметры соединения
 * (src/lib/net.ts): хост, порт и протокол. Нестандартный порт указывается явно, иначе CSP его блокирует.
 */
export function buildCsp(env: Record<string, string | undefined>): string {
  const broker = env.VITE_PEER_HOST || '0.peerjs.com';
  const port = Number(env.VITE_PEER_PORT) || 0;
  const secure = env.VITE_PEER_SECURE !== 'false';
  const sources = secure
    ? // порт 443 — стандартный для https и wss; любой другой должен быть назван явно
      (() => {
        const hostPort = port && port !== 443 ? `${broker}:${port}` : broker;
        return `https://${hostPort} wss://${hostPort}`;
      })()
    : `http://${broker}:${port || '*'} ws://${broker}:${port || '*'}`;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // inline-атрибуты style у React (ширины индикаторов)
    "img-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self'",
    // Публичный брокер доступен и по умолчанию: порт задан только у своего.
    `connect-src 'self' ${sources}`,
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
}
