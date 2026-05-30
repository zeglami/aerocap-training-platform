import { z } from 'zod';

// ── Enums ──────────────────────────────────────────────────────────────────────

export const BLOCK_TYPES = [
  'HOLIDAY','MAINTENANCE','AUTHORITY_INSPECTION','WEATHER_CLOSURE','SPECIAL_EVENT','OTHER',
] as const;
export type BlockType = typeof BLOCK_TYPES[number];

export const MAINTENANCE_TYPES = [
  'SCHEDULED_100H','SCHEDULED_500H','ANNUAL_RECERTIFICATION',
  'COMPONENT_REPLACEMENT','SOFTWARE_UPGRADE','UNSCHEDULED','FSTD_REQUALIFICATION',
] as const;
export type MaintenanceType = typeof MAINTENANCE_TYPES[number];

export const REGIONS = ['FR','ZA','CN','IN'] as const;
export type Region = typeof REGIONS[number];

// ── DailyWindow ────────────────────────────────────────────────────────────────

export const DailyWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime:  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'openTime must be HH:MM'),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'closeTime must be HH:MM'),
  isOpen:    z.boolean(),
}).refine(d => !d.isOpen || d.closeTime > d.openTime, {
  message: 'closeTime must be after openTime when isOpen is true',
});
export type DailyWindowInput = z.infer<typeof DailyWindowSchema>;

// Simulator IDs in the dev seed use slug format (e.g. 'sim-a320-1'), not UUIDs.
// Accept any non-empty string so the validation works with both dev slugs and prod UUIDs.
const simulatorIdZ = z.string().min(1);

// ── Operating Schedules ────────────────────────────────────────────────────────

export const CreateOperatingScheduleSchema = z.object({
  simulatorId:    simulatorIdZ.nullable().optional(),
  name:           z.string().min(1).max(255),
  effectiveFrom:  z.string().date(),
  effectiveUntil: z.string().date().nullable().optional(),
  timeZone:       z.string().min(1).max(64).default('UTC'),
  dailyWindows:   z.array(DailyWindowSchema).length(7, 'Exactly 7 DailyWindow entries required (Mon–Sun)'),
  notes:          z.string().max(2000).nullable().optional(),
});
export type CreateOperatingScheduleInput = z.infer<typeof CreateOperatingScheduleSchema>;

export const UpdateOperatingScheduleSchema = z.object({
  name:           z.string().min(1).max(255).optional(),
  effectiveUntil: z.string().date().nullable().optional(),
  dailyWindows:   z.array(DailyWindowSchema).length(7).optional(),
  notes:          z.string().max(2000).nullable().optional(),
}).strict();

export const ActivateScheduleSchema = z.object({
  effectiveFrom:  z.string().date(),
  effectiveUntil: z.string().date().nullable().optional(),
});

// ── Blocked Periods ────────────────────────────────────────────────────────────

export const CreateBlockedPeriodSchema = z.object({
  simulatorId:    simulatorIdZ.nullable().optional(),
  blockType:      z.enum(BLOCK_TYPES),
  title:          z.string().min(1).max(255),
  description:    z.string().max(4000).nullable().optional(),
  startAt:        z.string().datetime(),
  endAt:          z.string().datetime(),
  isPublic:       z.boolean().default(true),
  recurrenceRule: z.string().max(255).nullable().optional(),
  affectsSlots:   z.boolean().default(true),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), {
  message: 'endAt must be after startAt', path: ['endAt'],
});
export type CreateBlockedPeriodInput = z.infer<typeof CreateBlockedPeriodSchema>;

export const UpdateBlockedPeriodSchema = z.object({
  title:       z.string().min(1).max(255).optional(),
  description: z.string().max(4000).nullable().optional(),
  endAt:       z.string().datetime().optional(),
  isPublic:    z.boolean().optional(),
}).strict();

// ── Maintenance ────────────────────────────────────────────────────────────────

export const CreateMaintenanceSchema = z.object({
  simulatorId:              simulatorIdZ,
  maintenanceType:          z.enum(MAINTENANCE_TYPES),
  title:                    z.string().min(1).max(255),
  description:              z.string().max(4000).nullable().optional(),
  plannedStartAt:           z.string().datetime(),
  plannedEndAt:             z.string().datetime(),
  technicianName:           z.string().max(255).nullable().optional(),
  authorityReferenceNumber: z.string().max(128).nullable().optional(),
  partialOperationAllowed:  z.boolean().default(false),
  qualificationLevelDuring: z.string().max(16).nullable().optional(),
  autoCreateBlockedPeriod:  z.boolean().default(true),
}).refine(d => new Date(d.plannedEndAt) > new Date(d.plannedStartAt), {
  message: 'plannedEndAt must be after plannedStartAt', path: ['plannedEndAt'],
});
export type CreateMaintenanceInput = z.infer<typeof CreateMaintenanceSchema>;

export const UpdateMaintenanceSchema = z.object({
  plannedEndAt:             z.string().datetime().optional(),
  status:                   z.enum(['PLANNED','IN_PROGRESS','COMPLETED','CANCELLED']).optional(),
  technicianName:           z.string().max(255).optional(),
  authorityReferenceNumber: z.string().max(128).optional(),
  partialOperationAllowed:  z.boolean().optional(),
  qualificationLevelDuring: z.string().max(16).nullable().optional(),
  completionNotes:          z.string().max(4000).optional(),
}).strict();

export const CompleteMaintenanceSchema = z.object({
  actualEndAt:              z.string().datetime().optional(),
  completionNotes:          z.string().min(10).max(4000),
  authorityReferenceNumber: z.string().max(128).optional(),
});

// ── Availability Overrides ─────────────────────────────────────────────────────

export const CreateOverrideSchema = z.object({
  simulatorId: simulatorIdZ.nullable().optional(),
  title:       z.string().min(1).max(255),
  startAt:     z.string().datetime(),
  endAt:       z.string().datetime(),
  reason:      z.string().max(2000).nullable().optional(),
  isPublic:    z.boolean().default(true),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), {
  message: 'endAt must be after startAt', path: ['endAt'],
});

// ── Calendar / Availability ────────────────────────────────────────────────────

export const CalendarQuerySchema = z.object({
  from:        z.string().date(),
  until:       z.string().date(),
  simulatorId: simulatorIdZ.optional(),
}).refine(d => d.until >= d.from, { message: 'until must be >= from' })
  .refine(d => {
    const days = (new Date(d.until).getTime() - new Date(d.from).getTime()) / 86_400_000;
    return days <= 92;
  }, { message: 'Calendar range cannot exceed 92 days' });

export const AvailabilityCheckSchema = z.object({
  simulatorId: simulatorIdZ,
  startAt:     z.string().datetime(),
  endAt:       z.string().datetime(),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), {
  message: 'endAt must be after startAt',
});

// ── Holidays import ────────────────────────────────────────────────────────────

export const ImportHolidaysSchema = z.object({
  year:   z.coerce.number().int().min(2024).max(2035),
  region: z.enum(REGIONS).optional(),
  dryRun: z.coerce.boolean().default(false),
});

// ── Pagination ─────────────────────────────────────────────────────────────────

export function parsePagination(query: Record<string, unknown>) {
  const page   = Math.max(1, parseInt(String(query.page  ?? '1')) || 1);
  const limit  = Math.min(Math.max(1, parseInt(String(query.limit ?? '25')) || 25), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
