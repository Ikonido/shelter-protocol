import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../../scripts/private-address.mjs';

describe('LAN server address filter', () => {
  it('accepts private and loopback addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.1', '::1', '::ffff:192.168.1.9', 'fe80::1', 'fd12::1', '169.254.1.1'])
      expect(isPrivateAddress(a), a).toBe(true);
  });
  it('rejects public and malformed addresses', () => {
    for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '2001:db8::1', '', 'garbage', '11.0.0.1'])
      expect(isPrivateAddress(a), a).toBe(false);
  });
});
