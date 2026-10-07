/** true для адресов частных сетей: loopback, RFC1918, link-local, IPv6 ULA/link-local. */
export function isPrivateAddress(addr = '') {
  const a = addr.replace(/^::ffff:/, '');
  if (a === '::1' || /^fe80:/i.test(a) || /^f[cd][0-9a-f]{2}:/i.test(a)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254);
}
