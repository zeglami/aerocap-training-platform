import { z } from 'zod';

// ─── Line Training Assignment ─────────────────────────────────────────────────

export const ltaCreateZ = z.object({
  pilotId:                z.string().uuid(),
  programmeEnrolmentId:   z.string().uuid(),
  lineTrainingCaptainId:  z.string().uuid(),
  startDate:              z.string().date(),
  plannedSectors:         z.number().int().min(1).max(500),
});
export type LtaCreateInput = z.infer<typeof ltaCreateZ>;

export const ltaUpdateZ = z.object({
  status:           z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'TERMINATED']).optional(),
  completedSectors: z.number().int().min(0).optional(),
});
export type LtaUpdateInput = z.infer<typeof ltaUpdateZ>;

// ─── Sector Log ───────────────────────────────────────────────────────────────

export const sectorCreateZ = z
  .object({
    pilotId:                  z.string().uuid(),
    lineTrainingAssignmentId: z.string().uuid().nullable().optional(),
    flightDate:               z.string().date(),
    flightNumber:             z.string().min(1).max(16),
    aircraftRegistration:     z.string().min(2).max(16),
    aircraftType:             z.string().min(2).max(32),
    departureIcao:            z.string().length(4),
    arrivalIcao:              z.string().length(4),
    blockOutAt:               z.string().datetime(),
    takeoffAt:                z.string().datetime(),
    landingAt:                z.string().datetime(),
    blockInAt:                z.string().datetime(),
    pilotFlyingRole:          z.enum(['PF', 'PM']),
    commanderId:              z.string().uuid(),
    instructorId:             z.string().uuid().nullable().optional(),
    landingsCount:            z.number().int().min(0).max(20),
    takeoffsCount:            z.number().int().min(0).max(20),
    nightFlightMinutes:       z.number().int().min(0),
    ifrTimeMinutes:           z.number().int().min(0),
    picTimeMinutes:           z.number().int().min(0),
    sicTimeMinutes:           z.number().int().min(0),
    source:                   z.enum(['EFB', 'OPS_SYSTEM', 'MANUAL']),
  })
  .superRefine((d, ctx) => {
    if (new Date(d.blockOutAt) >= new Date(d.takeoffAt)) {
      ctx.addIssue({ code: 'custom', message: 'takeoffAt must be after blockOutAt', path: ['takeoffAt'] });
    }
    if (new Date(d.takeoffAt) >= new Date(d.landingAt)) {
      ctx.addIssue({ code: 'custom', message: 'landingAt must be after takeoffAt', path: ['landingAt'] });
    }
    if (new Date(d.landingAt) >= new Date(d.blockInAt)) {
      ctx.addIssue({ code: 'custom', message: 'blockInAt must be after landingAt', path: ['blockInAt'] });
    }
  });
export type SectorCreateInput = z.infer<typeof sectorCreateZ>;

export const sectorBulkCreateZ = z.object({
  idempotencyKey: z.string().uuid(),
  sectors:        z.array(sectorCreateZ).min(1).max(200),
});
export type SectorBulkCreateInput = z.infer<typeof sectorBulkCreateZ>;

// ─── Sector Assessment ────────────────────────────────────────────────────────

export const sectorAssessmentUpsertZ = z.object({
  debriefAt:             z.string().datetime(),
  overallOutcome:        z.enum(['SATISFACTORY', 'UNSATISFACTORY', 'RECOMMENDED_FOR_RELEASE']),
  competencyScores:      z.record(
    z.enum(['AP', 'COM', 'FPA', 'FPM', 'LT', 'PSD', 'SA', 'WM']),
    z.number().int().min(1).max(5),
  ),
  narrative:             z.string().min(20).max(8000),
  instructorQualification: z.string().min(1).max(16),
  sessionType:           z.literal('LIFUS').default('LIFUS'),
  assessedAt:            z.string().datetime(),
});
export type SectorAssessmentUpsertInput = z.infer<typeof sectorAssessmentUpsertZ>;

// ─── Line Check Release ───────────────────────────────────────────────────────

export const lineCheckReleaseCreateZ = z.object({
  pilotId:              z.string().uuid(),
  programmeEnrolmentId: z.string().uuid(),
  releasedAt:           z.string().datetime(),
  narrative:            z.string().min(50).max(8000),
  documentRef:          z.string().max(255).optional(),
});
export type LineCheckReleaseCreateInput = z.infer<typeof lineCheckReleaseCreateZ>;
