import { z } from 'zod';

// ─── Shared enums ──────────────────────────────────────────────────────────────

export const programmeTypeZ = z.enum([
  'INITIAL','RECURRENT','UPGRADE','CONVERSION',
  'TYPE_RATING','OPC','LPC','EBT','MCC','JOC','UPRT','LIFUS','TRI_COURSE','TRE_COURSE',
]);
export const regulatoryFrameworkZ = z.enum(['EASA','FAA','SACAA','DGCA','CAAC','ICAO']);
export const deliveryModeZ = z.enum(['CBT','GROUND','FBS','FTD','FNPT','FFS','AIRCRAFT','LIFUS']);
export const cuCodeZ = z.enum(['AP','COM','FPA','FPM','LT','PSD','SA','WM']);
export const gateCriterionTypeZ = z.enum([
  'MIN_CU_SCORE','ALL_MODULES_COMPLETE','MEDICAL_VALID','RECENCY_OK',
  'LIFUS_SECTORS_MIN','EXAMINER_SIGN_OFF','LICENCE_VALID','INSTRUCTOR_SIGN_OFF','NO_OPEN_DEFICITS',
]);
export const gateStrategyZ = z.enum(['ALL_CRITERIA','ANY_CRITERION','CFI_OVERRIDE_ALLOWED']);
export const sessionTypeZ = z.enum(['ITR','RECURRENT','OPC','LPC','LINE_CHECK','UPRT','EBT','FREE_PRACTICE']);
export const trainingOutcomeZ = z.enum(['PASS','FURTHER_TRAINING_REQUIRED','FAIL','TRAINING_ONLY']);
export const simQualLevelZ = z.enum(['FFS_A','FFS_B','FFS_C','FFS_D','FTD','FNPT','AIRCRAFT','N_A']);

// ─── Programme ─────────────────────────────────────────────────────────────────

export const programmeCreateZ = z.object({
  code:                  z.string().min(1).max(64),
  name:                  z.string().min(1).max(255),
  aircraftType:          z.string().min(2).max(32),
  type:                  programmeTypeZ,
  regulatoryFramework:   regulatoryFrameworkZ,
  regulatoryBasis:       z.array(z.string().min(1)).min(1),
  validityMonths:        z.number().int().positive().nullable().optional(),
  prerequisiteRatings:   z.array(z.string().min(1)).default([]),
  authorityApprovalRef:  z.string().min(1).max(128),
  approvalValidFrom:     z.string().date(),
  approvalValidUntil:    z.string().date().nullable().optional(),
  supersedesProgrammeId: z.string().uuid().nullable().optional(),
});
export type ProgrammeCreateInput = z.infer<typeof programmeCreateZ>;

export const programmeUpdateZ = z.object({
  name:                 z.string().min(1).max(255).optional(),
  approvalValidUntil:   z.string().date().optional(),
  authorityApprovalRef: z.string().min(1).max(128).optional(),
  regulatoryBasis:      z.array(z.string().min(1)).min(1).optional(),
  validityMonths:       z.number().int().positive().nullable().optional(),
  prerequisiteRatings:  z.array(z.string().min(1)).optional(),
});
export type ProgrammeUpdateInput = z.infer<typeof programmeUpdateZ>;

export const approveProgrammeZ = z.object({
  authorityApprovalRef: z.string().min(1).max(128),
  approvalValidFrom:    z.string().date(),
  approvalValidUntil:   z.string().date().nullable().optional(),
});
export type ApproveProgrammeInput = z.infer<typeof approveProgrammeZ>;

// ─── Phase ─────────────────────────────────────────────────────────────────────

export const phaseCreateZ = z.object({
  sequence:               z.number().int().min(1),
  code:                   z.string().min(1).max(64),
  name:                   z.string().min(1).max(255),
  deliveryMode:           deliveryModeZ,
  minimumSessions:        z.number().int().min(0),
  plannedDurationMinutes: z.number().int().min(0),
  gateStrategy:           gateStrategyZ.default('ALL_CRITERIA'),
});
export type PhaseCreateInput = z.infer<typeof phaseCreateZ>;

// ─── Module ────────────────────────────────────────────────────────────────────

export const moduleCreateZ = z.object({
  sequence:               z.number().int().min(1),
  code:                   z.string().min(1).max(64),
  name:                   z.string().min(1).max(255),
  sessionType:            sessionTypeZ.optional(),
  minimumDurationMinutes: z.number().int().min(0).default(0),
  competencyUnitCodes:    z.array(cuCodeZ).min(1).max(8),
  learningObjectives:     z.array(z.string().min(1)).default([]),
  mandatory:              z.boolean().default(true),
  minimumOverallScore:    z.number().int().min(1).max(5).nullable().optional(),
});
export type ModuleCreateInput = z.infer<typeof moduleCreateZ>;

// ─── Prerequisite ──────────────────────────────────────────────────────────────

export const prereqCreateZ = z.object({
  prerequisiteModuleId:    z.string().uuid().optional(),
  prerequisiteProgrammeId: z.string().uuid().optional(),
  prerequisiteRatingCode:  z.string().min(1).max(64).optional(),
  type:                    z.enum(['HARD','SOFT','ADVISORY']),
  waiverAllowedByRole:     z.enum(['CFI','TRE','NONE']).default('NONE'),
}).refine(
  d => !!(d.prerequisiteModuleId || d.prerequisiteProgrammeId || d.prerequisiteRatingCode),
  { message: 'One of prerequisiteModuleId, prerequisiteProgrammeId, or prerequisiteRatingCode is required' }
);
export type PrereqCreateInput = z.infer<typeof prereqCreateZ>;

// ─── Gate criterion ────────────────────────────────────────────────────────────

export const gateCreateZ = z.object({
  criterionType:    gateCriterionTypeZ,
  parameters:       z.record(z.unknown()).default({}),
  blocksProgression: z.boolean().default(true),
  evidenceService:  z.string().max(64).nullable().optional(),
});
export type GateCreateInput = z.infer<typeof gateCreateZ>;

// ─── Competency target ─────────────────────────────────────────────────────────

export const competencyTargetCreateZ = z.object({
  competencyUnitCode:       cuCodeZ,
  phaseId:                  z.string().uuid().nullable().optional(),
  minimumScore:             z.number().int().min(1).max(5).default(3),
  remedialTriggerScore:     z.number().int().min(1).max(5).default(2),
  requiredAssessmentCount:  z.number().int().positive().default(1),
});
export type CompetencyTargetCreateInput = z.infer<typeof competencyTargetCreateZ>;

// ─── Enrolment ─────────────────────────────────────────────────────────────────

export const enrolmentCreateZ = z.object({
  pilotId:              z.string().uuid(),
  expectedCompletionAt: z.string().datetime().nullable().optional(),
});
export type EnrolmentCreateInput = z.infer<typeof enrolmentCreateZ>;

// ─── Gate override ─────────────────────────────────────────────────────────────

export const gateOverrideZ = z.object({
  phaseId: z.string().uuid(),
  reason:  z.string().min(20).max(2000),
});
export type GateOverrideInput = z.infer<typeof gateOverrideZ>;

// ─── Training session record ───────────────────────────────────────────────────

export const sessionCreateZ = z.object({
  enrolmentId:                 z.string().uuid().nullable().optional(),
  programmeModuleId:           z.string().uuid().nullable().optional(),
  reservationId:               z.string().uuid().nullable().optional(),
  pilotId:                     z.string().uuid(),
  instructorId:                z.string().uuid(),
  instructorQualification:     z.string().min(1).max(128),
  examinerRequired:            z.boolean().default(false),
  examinerId:                  z.string().uuid().nullable().optional(),
  examinerAuthorisationRef:    z.string().max(128).nullable().optional(),
  sessionType:                 sessionTypeZ,
  scenarioId:                  z.string().uuid().nullable().optional(),
  aircraftType:                z.string().min(2).max(32),
  simulatorId:                 z.string().uuid().nullable().optional(),
  simulatorQualificationLevel: simQualLevelZ.nullable().optional(),
  simulatorApprovalRef:        z.string().max(128).nullable().optional(),
  startedAt:                   z.string().datetime(),
  endedAt:                     z.string().datetime(),
  assessedAt:                  z.string().datetime(),
  outcome:                     trainingOutcomeZ,
}).superRefine((d, ctx) => {
  if (new Date(d.endedAt) <= new Date(d.startedAt)) {
    ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt must be after startedAt' });
  }
  if (d.examinerRequired && (!d.examinerId || !d.examinerAuthorisationRef)) {
    ctx.addIssue({ code: 'custom', path: ['examinerId'], message: 'examinerId and examinerAuthorisationRef are required when examinerRequired is true' });
  }
});
export type SessionCreateInput = z.infer<typeof sessionCreateZ>;

// ─── Competency assessments ────────────────────────────────────────────────────

export const assessmentInputZ = z.object({
  competencyUnitCode: cuCodeZ,
  score:              z.number().int().min(1).max(5),
  behaviouralMarkers: z.array(z.record(z.unknown())).default([]),
  notes:              z.string().max(4000).nullable().optional(),
});

export const upsertAssessmentsZ = z.object({
  assessments: z.array(assessmentInputZ).min(1),
});
export type UpsertAssessmentsInput = z.infer<typeof upsertAssessmentsZ>;

// ─── Sign session ──────────────────────────────────────────────────────────────

export const signSessionZ = z.object({
  signatureHash: z.string().min(32).max(255),
});
export type SignSessionInput = z.infer<typeof signSessionZ>;

// ─── Amend locked session ──────────────────────────────────────────────────────

export const amendSessionZ = z.object({
  outcome:         trainingOutcomeZ.optional(),
  amendmentReason: z.string().min(20).max(2000),
});
export type AmendSessionInput = z.infer<typeof amendSessionZ>;
