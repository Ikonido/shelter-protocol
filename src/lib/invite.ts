import { isValidCode, isValidTicket } from './net';

export interface Invite {
  code: string;
  ticket?: string;
}

/** Разбор содержимого QR: ссылка вида …#join=КОД.БИЛЕТ или просто код комнаты. Чужие QR-коды отбрасываются. */
export function parseInvite(text: string): Invite | null {
  const s = text.trim().slice(0, 400);
  const m = /#join=([A-Za-z0-9]{5})(?:\.([A-Za-z0-9]{6}))?$/.exec(s) ?? /^([A-Za-z0-9]{5})$/.exec(s);
  if (!m) return null;
  const code = m[1].toUpperCase();
  if (!isValidCode(code)) return null;
  const ticket = m[2]?.toUpperCase();
  return ticket && isValidTicket(ticket) ? { code, ticket } : { code };
}
