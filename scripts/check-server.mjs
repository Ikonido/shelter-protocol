#!/usr/bin/env node
// Проверка своего сервера: node scripts/check-server.mjs peer.example.com [порт] [--insecure]
// Убеждается, что по адресу отвечает посредник PeerJS, и показывает, что вписать в настройки сборки.
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const insecure = process.argv.includes('--insecure');
const host = args[0];
if (!host) {
  console.error('Использование: node scripts/check-server.mjs <адрес> [порт] [--insecure]');
  process.exit(2);
}
const port = args[1] ?? (insecure ? '80' : '443');
const url = `${insecure ? 'http' : 'https'}://${host}:${port}/`;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.name === 'PeerJS Server') {
    console.log(`OK: ${url} отвечает как посредник PeerJS.`);
    console.log('\nВ GitHub: Settings → Secrets and variables → Actions → Variables добавьте:');
    console.log(`  VITE_PEER_HOST = ${host}`);
    console.log(`  VITE_PEER_PORT = ${port}`);
    console.log(`  VITE_PEER_SECURE = ${insecure ? 'false' : 'true'}`);
    process.exit(0);
  }
  console.error(`Ответ получен, но это не посредник PeerJS (код ${res.status}).`);
} catch (e) {
  console.error(`Не удалось подключиться к ${url}: ${e.cause?.code ?? e.message}`);
}
process.exit(1);
