#!/usr/bin/env node
/**
 * Сервер для игры по локальной сети (интернет не нужен).
 * Раздаёт собранное приложение (dist/) и брокер соединений PeerJS на одном порту.
 *
 *   npm run lan            # сборка + запуск
 *   PORT=9000 npm run lan  # другой порт
 *
 * Игровые данные по этому серверу не ходят: после рукопожатия устройства соединяются напрямую (WebRTC).
 * По умолчанию принимает только адреса частных сетей (192.168.x.x, 10.x.x.x, 172.16-31.x.x, 127.x, fe80/fc00),
 * чтобы случайно проброшенный порт не открыл комнату всему интернету. `--allow-public` отключает проверку.
 */
import express from 'express';
import { ExpressPeerServer } from 'peer';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateAddress } from './private-address.mjs';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const allowPublic = process.argv.includes('--allow-public');
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Не найден dist/. Сначала выполните: npm run build');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(dist, { dotfiles: 'ignore', index: 'index.html' }));

const server = http.createServer(app);
// Фильтр на уровне TCP: покрывает и HTTP, и WebSocket-апгрейд.
if (!allowPublic) {
  server.on('connection', (socket) => {
    if (!isPrivateAddress(socket.remoteAddress)) socket.destroy();
  });
}
app.use('/peerjs', ExpressPeerServer(server, { path: '/', allow_discovery: false, concurrent_limit: 200, alive_timeout: 60000 }));

server.listen(PORT, HOST, () => {
  console.log('\nShelter Protocol — сервер локальной сети запущен\n');
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`  Хост открывает:     http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Остальные открывают: http://${ip}:${PORT}`);
  if (!ips.length) console.log('  (не найдено сетевых интерфейсов — подключитесь к Wi-Fi/раздайте точку доступа)');
  console.log(allowPublic ? '\n  ВНИМАНИЕ: --allow-public, доступ не ограничен частными сетями.' : '\n  Принимаются только подключения из частных сетей.');
  console.log('  Остановка: Ctrl+C\n');
});
