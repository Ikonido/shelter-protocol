export type SecretRole = 'civilian' | 'officer' | 'maniac' | 'mafia';
export type Investigation = 'connections' | 'dossier' | 'actions';
export const EVIDENCE_KINDS = ['knife', 'identity', 'messages', 'supplies', 'medical', 'pass'] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
export interface ThreatConfig { criminal: 'maniac' | 'mafia'; report: 'hidden' | 'detailed' }
export interface SecretPlayer {
  role: SecretRole;
  points: number;
  checks: number;
  lastCheckRound: number;
  notices: string[];
  results: Finding[];
}
/** The provenance is host-only, even after discovery. */
export interface Evidence { id: string; target: string; actor: string; round: number; kind: EvidenceKind; forged: boolean }
export interface Finding {
  id: string; target: string; round: number; direction: Investigation;
  text: string; evidenceId?: string; analyzed: boolean; analysis?: string;
}
export type SecretOperation =
  | { kind: 'skip' }
  | { kind: 'investigate'; target: string; direction: Investigation }
  | { kind: 'plant' | 'forge'; target: string; evidence: EvidenceKind }
  | { kind: 'analyze'; findingId: string };
export interface SecretCommand {
  id: string; round: number; operation: SecretOperation; publish?: string[];
}
export interface Submitted { actor: string; command: SecretCommand }
export interface ThreatAudit { round: number; actor: string; target?: string; kind: string; text: string; points?: number }
export interface Publication { id: string; round: number; target: string; direction: Investigation; text: string; analysis?: string }
export interface ActivityReport { round: number; checks?: number; sabotages?: number; active: boolean }
export interface ThreatState {
  version: 1;
  players: Record<string, SecretPlayer>;
  evidence: Evidence[];
  pending: Submitted[];
  processed: string[];
  rewarded: string[];
  auxiliary: string[];
  sabotageUses: number;
  sabotageRound: number;
  resolvedRound: number;
  audit: ThreatAudit[];
  publications: Publication[];
  reports: ActivityReport[];
}
export interface SocialOutcome { civilians: boolean; maniac: string[]; mafia: boolean }
/** Wire DTO: never contains ThreatState, pending commands or evidence provenance. */
export interface ThreatView {
  version: 1;
  publications: Publication[];
  reports: ActivityReport[];
  ready: string[];
  me?: SecretPlayer & { playerId: string; allies: string[]; sabotageUses?: number; sabotageRound?: number; auxiliaryUsed: boolean; submitted: boolean };
  final?: { roles: Record<string, SecretRole>; audit: ThreatAudit[]; outcome: SocialOutcome };
}
