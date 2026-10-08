export type SecretRole = 'civilian' | 'police' | 'maniac' | 'mafia';
export type Investigation = 'connections' | 'dossier' | 'actions';
export type EvidenceType =
  'knife' | 'identity' | 'messages' | 'supplies' | 'medical' | 'permit';
export interface ThreatSettings {
  loneCriminal: 'maniac' | 'mafia';
  report: 'hidden' | 'detailed';
}
export type SecretOperation =
  | { kind: 'pass' }
  | { kind: 'investigate'; target: string; direction: Investigation }
  | {
      kind: 'sabotage';
      target: string;
      method: 'plant' | 'forge';
      evidence: EvidenceType;
    }
  | { kind: 'analyse'; finding: string };
export interface SecretCommand {
  id: string;
  round: number;
  operation: SecretOperation;
}
export interface Evidence {
  id: string;
  target: string;
  type: EvidenceType;
  forged: boolean;
  planted: boolean;
  actor?: string;
  round: number;
}
export type FindingResult =
  | 'links'
  | 'no-links'
  | 'material'
  | 'no-material'
  | 'activity'
  | 'no-activity'
  | 'tampered'
  | 'genuine';
export interface Finding {
  id: string;
  round: number;
  target: string;
  direction: Investigation;
  result: FindingResult;
  evidence?: EvidenceType;
  evidenceId?: string;
  detail?: string;
  analysed?: boolean;
}
export interface SecretPlayer {
  role: SecretRole;
  points: number;
  checks: number;
  lastCheckRound: number;
  findings: Finding[];
  notices: string[];
}
export interface Activity {
  round: number;
  actor: string;
  target: string;
  kind: 'help' | 'harm';
  detail: string;
}
export interface ThreatAudit {
  round: number;
  actor?: string;
  target?: string;
  kind: 'sabotage' | 'investigate' | 'analyse' | 'publish' | 'points';
  detail: string;
  points?: number;
}
export interface PublishedFinding {
  id: string;
  round: number;
  target: string;
  direction: Investigation;
  result: FindingResult;
  evidence?: EvidenceType;
  detail?: string;
}
export interface ThreatPublic {
  readiness: Record<string, number>;
  published: PublishedFinding[];
  reports: { round: number; checks?: number; sabotages?: number }[];
  publicationsReleased: number[];
}
/** Host-only. Never spread this object into a snapshot or a public export. */
export interface HiddenThreatState {
  version: 1;
  players: Record<string, SecretPlayer>;
  evidence: Evidence[];
  pending: Record<string, SecretCommand>;
  processed: string[];
  resolvedRounds: number[];
  sabotageUsed: number;
  lastSabotageRound: number;
  credited: string[];
  auxiliary: string[];
  activities: Activity[];
  audit: ThreatAudit[];
  public: ThreatPublic;
  pendingPublications: string[];
}
export interface ThreatFinal {
  roles: { playerId: string; role: SecretRole }[];
  winner: 'civilian' | 'maniac' | 'mafia' | 'unresolved';
  audit: ThreatAudit[];
}
/** Whitelisted recipient projection. Contains neither the role map nor raw dossiers. */
export interface HiddenThreatView {
  version: 1;
  public: ThreatPublic;
  mine?: {
    playerId: string;
    role: SecretRole;
    points: number;
    checks: number;
    lastCheckRound: number;
    findings: Finding[];
    notices: string[];
    allies: string[];
    sabotageUsed?: number;
    lastSabotageRound?: number;
    submitted: boolean;
    queuedPublications: string[];
  };
  final?: ThreatFinal;
}
export const ROLES: SecretRole[] = ['civilian', 'police', 'maniac', 'mafia'];
export const DIRECTIONS: Investigation[] = [
  'connections',
  'dossier',
  'actions',
];
export const EVIDENCE_TYPES: EvidenceType[] = [
  'knife',
  'identity',
  'messages',
  'supplies',
  'medical',
  'permit',
];
export const DOCUMENT_TYPES: EvidenceType[] = [
  'identity',
  'messages',
  'medical',
  'permit',
];
export const RESULTS: FindingResult[] = [
  'links',
  'no-links',
  'material',
  'no-material',
  'activity',
  'no-activity',
  'tampered',
  'genuine',
];
export const ROLE_LABEL: Record<SecretRole, string> = {
  civilian: 'Мирный житель',
  police: 'Полицейский',
  maniac: 'Маньяк',
  mafia: 'Мафия',
};
export const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  knife: 'Нож со следами крови',
  identity: 'Удостоверение',
  messages: 'Подозрительная переписка',
  supplies: 'Украденные припасы',
  medical: 'Медицинские записи',
  permit: 'Пропуск',
};
export const DIRECTION_LABEL: Record<Investigation, string> = {
  connections: 'Проверка связей',
  dossier: 'Проверка досье',
  actions: 'Проверка действий',
};
export const RESULT_LABEL: Record<FindingResult, string> = {
  links: 'Обнаружены признаки связи с преступной организацией',
  'no-links':
    'Связей с организацией не обнаружено; это не доказывает невиновность',
  material: 'Обнаружен материал; находка не доказывает виновность владельца',
  'no-material': 'Подозрительных материалов не обнаружено',
  activity: 'Зафиксирован вредоносный поступок; мотив неизвестен',
  'no-activity': 'Вредоносных поступков пока не зафиксировано',
  tampered:
    'Экспертиза обнаружила вмешательство или подделку; источник неизвестен',
  genuine: 'Материал подлинный; это не устанавливает виновность',
};
