export type UserRole = 'GLOBAL_ADMIN' | 'COUNTRY_ADMIN' | 'MANAGER' | 'INSTRUCTOR' | 'PILOT';
export type Region  = 'FR' | 'ZA' | 'CN' | 'IN';

export const REGION_LABELS: Record<Region, string> = {
  FR: 'France',
  ZA: 'South Africa',
  CN: 'China',
  IN: 'India',
};

export const REGION_TENANT: Record<Region, string> = {
  FR: 'tenant-demo',
  ZA: 'tenant-za',
  CN: 'tenant-cn',
  IN: 'tenant-in',
};

export const TENANT_REGION: Record<string, Region> = {
  'tenant-demo': 'FR',
  'tenant-za':   'ZA',
  'tenant-cn':   'CN',
  'tenant-in':   'IN',
};

export interface AuthUser {
  id:                string;
  email:             string;
  firstName:         string;
  lastName:          string;
  role:              UserRole;
  tenantId:          string;
  bookingAuthorized: boolean;
  signupMethod?:     'admin' | 'self';
  managerRegions?:   Region[] | null;   // null = global, Region[] = scoped, undefined = not a manager
  managerHomeTenant?: string;
}

export interface Tenant {
  id: string; name: string; slug: string;
  region: 'FR' | 'ZA' | 'CN' | 'IN';
  plan: 'STANDARD' | 'ENTERPRISE';
  created_at: string;
}

export interface Simulator {
  id: string; tenant_id: string; name: string;
  type: string; aircraft: string; location: string; capacity: number; created_at: string;
}

export interface Slot {
  id: string; tenant_id: string; simulator_id: string;
  simulator_name: string; aircraft: string;
  start_time: string; end_time: string; is_available: number;
}

export type SessionType = 'ITR' | 'RECURRENT' | 'OPC' | 'LPC' | 'LINE_CHECK' | 'UPRT' | 'EBT' | 'FREE_PRACTICE';

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  ITR:           'Initial Type Rating',
  RECURRENT:     'Recurrent Training',
  OPC:           'Operator Proficiency Check',
  LPC:           'Licence Proficiency Check',
  LINE_CHECK:    'Line Check Prep',
  UPRT:          'Upset Prevention & Recovery',
  EBT:           'Evidence-Based Training',
  FREE_PRACTICE: 'Free Practice',
};

export interface Reservation {
  id: string; tenant_id: string; pilot_id: string;
  slot_id: string; simulator_id: string;
  simulator_name: string; aircraft: string; location: string;
  start_time: string; end_time: string;
  session_type: SessionType;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  notes: string | null; created_at: string;
}

export interface CompetencyUnit {
  id: string; tenant_id: string; code: string;
  name: string; description: string;
  category: 'TECHNICAL' | 'NON_TECHNICAL'; created_at: string;
}

export interface Assessment {
  id: string; tenant_id: string; pilot_id: string;
  instructor_id: string; competency_unit_id: string;
  code: string; unit_name: string; category: string;
  score: number; notes: string | null; assessed_at: string;
}

export interface ProgressItem {
  id: string; code: string; name: string; category: string;
  latest_score: number | null; last_assessed: string | null;
  total_assessments: number; average_score: number | null;
}

// ── HRIS ──────────────────────────────────────────────────────────────────────

export type LicenceType = 'ATPL' | 'CPL' | 'IR' | 'MEDICAL_CLASS1' | 'MEDICAL_CLASS2' | 'ENGLISH_LANGUAGE' | 'LAPL' | 'PPL';
export type LicenceStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
export type NotificationSeverity = 'INFO' | 'WARNING' | 'DANGER';
export type NotificationType = 'LICENCE_EXPIRY' | 'LICENCE_EXPIRED' | 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'CBTA_ASSESSMENT' | 'SYSTEM';

export const LICENCE_LABELS: Record<LicenceType, string> = {
  ATPL:             'ATPL',
  CPL:              'CPL',
  IR:               'Instrument Rating',
  MEDICAL_CLASS1:   'Medical Class 1',
  MEDICAL_CLASS2:   'Medical Class 2',
  ENGLISH_LANGUAGE: 'English Language Proficiency',
  LAPL:             'LAPL',
  PPL:              'PPL',
};

export interface Licence {
  id: string; tenant_id: string; pilot_id: string;
  type: LicenceType; number: string | null;
  issuing_authority: string | null;
  issued_at: string | null; expires_at: string;
  status: LicenceStatus; days_remaining: number;
}

export interface TypeRating {
  id: string; tenant_id: string; pilot_id: string;
  aircraft_type: string; aircraft_full: string;
  rated_at: string; expires_at: string | null; created_at: string;
}

export interface PilotProfile {
  pilot_id: string; tenant_id: string;
  licence_number: string | null; nationality: string | null;
  date_of_birth: string | null; home_base: string | null;
  total_hours: number; simulator_hours: number;
  notes: string | null;
}

export interface Notification {
  id: string; tenant_id: string; pilot_id: string;
  type: NotificationType; title: string; message: string;
  severity: NotificationSeverity; is_read: number;
  reference_id: string | null; created_at: string;
}

export interface ApiResponse<T> {
  data:  T;
  meta:  { requestId: string; timestamp: string; page?: number; limit?: number; total?: number; unreadCount?: number };
  error: null | { code: string; message: string };
}
