import { z } from 'zod';

export const cuCodeZ = z.enum(['AP', 'COM', 'FPA', 'FPM', 'LT', 'PSD', 'SA', 'WM']);

export const deficitCreateZ = z.object({
  pilotId:                    z.string().uuid(),
  originatingAssessmentId:    z.string().uuid(),
  competencyUnitCode:         cuCodeZ,
  originatingScore:           z.literal(1).or(z.literal(2)),
  originatingSessionId:       z.string().uuid(),
  severity:                   z.enum(['REMEDIAL', 'TRAINING_REQUIRED']),
  instructorId:               z.string().uuid(),
  simulatorId:                z.string().uuid().or(z.string().min(1).max(64)),
  simulatorQualificationLevel: z.string().min(1).max(8),
  instructorQualification:    z.string().min(1).max(16),
  sessionType:                z.string().min(1).max(16),
  assessedAt:                 z.string().datetime(),
});
export type DeficitCreateInput = z.infer<typeof deficitCreateZ>;

export const deficitPatchZ = z.object({
  cfiId:       z.string().min(1).max(64).optional(),
  instructorId: z.string().min(1).max(64).optional(),
  dueAt:       z.string().datetime().optional(),
  status:      z.enum(['OPEN', 'REASSESSMENT_SCHEDULED', 'UNDER_REMEDIATION', 'RESOLVED', 'ESCALATED', 'WAIVED']).optional(),
}).strict();
export type DeficitPatchInput = z.infer<typeof deficitPatchZ>;

export const remedialActionCreateZ = z.object({
  actionType:   z.enum(['BRIEFING', 'GROUND_TRAINING', 'FFS_SESSION', 'FTD_SESSION', 'LINE_OPS_FOCUS']),
  description:  z.string().min(10).max(2000),
  plannedDate:  z.string().date(),
  instructorId: z.string().uuid(),
});
export type RemedialActionCreateInput = z.infer<typeof remedialActionCreateZ>;

export const remedialActionCompleteZ = z.object({
  completedDate:   z.string().date(),
  durationMinutes: z.number().int().positive().max(720),
  notes:           z.string().max(2000).optional(),
});
export type RemedialActionCompleteInput = z.infer<typeof remedialActionCompleteZ>;

export const reassessmentScheduleZ = z.object({
  scheduledFor:    z.string().datetime(),
  scheduledSlotId: z.string().uuid().optional(),
});
export type ReassessmentScheduleInput = z.infer<typeof reassessmentScheduleZ>;

export const reassessmentOutcomeZ = z.object({
  conductedAt:                z.string().datetime(),
  conductedByInstructorId:    z.string().uuid(),
  resultingAssessmentId:      z.string().uuid(),
  outcome:                    z.enum(['PASS', 'FAIL', 'NO_SHOW', 'CANCELLED']),
  simulatorId:                z.string().min(1).max(64).optional(),
  simulatorQualificationLevel: z.string().max(8).optional(),
});
export type ReassessmentOutcomeInput = z.infer<typeof reassessmentOutcomeZ>;

export const deficitWaiveZ = z.object({
  reason:       z.string().min(50).max(4000),
  authorityRef: z.string().min(1).max(128),
});
export type DeficitWaiveInput = z.infer<typeof deficitWaiveZ>;

export const escalateZ = z.object({
  reason: z.string().min(10).max(2000),
});
export type EscalateInput = z.infer<typeof escalateZ>;
