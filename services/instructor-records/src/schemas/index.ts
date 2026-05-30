import { z } from 'zod';

export const primaryRoleZ = z.enum(['CFI','TRI','TRE','SFI','SFE','CRI','FI','IRI']);
export const qualificationTypeZ = z.enum(['TRI','TRE','SFI','SFE','CRI','FI','IRI','EXAMINER_SE','EXAMINER_ME']);
export const examinerAuthTypeZ = z.enum(['OPC','LPC','SKILL_TEST','PROFICIENCY_CHECK','TYPE_RATING_TEST']);
export const instructorEventTypeZ = z.enum(['INITIAL_COURSE','REFRESHER','STANDARDISATION','ASSESSMENT_OF_COMPETENCE','PROFICIENCY_CHECK']);

export const instructorCreateZ = z.object({
  userId:         z.string().uuid(),
  employeeNumber: z.string().min(1).max(64),
  primaryRole:    primaryRoleZ,
  hireDate:       z.string().date(),
});
export type InstructorCreateInput = z.infer<typeof instructorCreateZ>;

export const instructorUpdateZ = z.object({
  primaryRole: primaryRoleZ.optional(),
  status:      z.enum(['ACTIVE','INACTIVE','SUSPENDED']).optional(),
});
export type InstructorUpdateInput = z.infer<typeof instructorUpdateZ>;

export const qualificationCreateZ = z.object({
  qualificationType:        qualificationTypeZ,
  aircraftType:             z.string().min(2).max(32),
  regulatoryFramework:      z.enum(['EASA','FAA','SACAA','DGCA','CAAC']),
  authorityReferenceNumber: z.string().min(1).max(128),
  issuedAt:                 z.string().date(),
  validFrom:                z.string().date(),
  validUntil:               z.string().date(),
  issuingAuthority:         z.string().min(1).max(128),
  restrictions:             z.array(z.string()).default([]),
}).refine(d => d.validUntil > d.validFrom, { message: 'validUntil must be after validFrom' });
export type QualificationCreateInput = z.infer<typeof qualificationCreateZ>;

export const qualificationUpdateZ = z.object({
  validUntil:   z.string().date().optional(),
  restrictions: z.array(z.string()).optional(),
});
export type QualificationUpdateInput = z.infer<typeof qualificationUpdateZ>;

export const revokeZ = z.object({
  reason: z.string().min(20).max(2000),
});
export type RevokeInput = z.infer<typeof revokeZ>;

export const examinerAuthCreateZ = z.object({
  authorisationType:        examinerAuthTypeZ,
  aircraftType:             z.string().min(2).max(32),
  validFrom:                z.string().date(),
  validUntil:               z.string().date(),
  authorityReferenceNumber: z.string().min(1).max(128),
  restrictions:             z.array(z.string()).default([]),
});
export type ExaminerAuthCreateInput = z.infer<typeof examinerAuthCreateZ>;

export const instructorTrainingRecordCreateZ = z.object({
  eventType:                  instructorEventTypeZ,
  eventDate:                  z.string().date(),
  validUntil:                 z.string().date(),
  conductedByExaminerId:      z.string().uuid(),
  simulatorId:                z.string().uuid(),
  simulatorQualificationLevel: z.string().min(1).max(8),
  outcome:                    z.enum(['PASS','FAIL']),
  documentRef:                z.string().max(255).optional(),
});
export type InstructorTrainingRecordCreateInput = z.infer<typeof instructorTrainingRecordCreateZ>;

export const restrictionCreateZ = z.object({
  restrictionType: z.enum(['NO_SOLO_LIFUS','UNDER_SUPERVISION','SPECIFIC_PROGRAMME']),
  parameters:      z.record(z.unknown()),
  validUntil:      z.string().date().nullable().optional(),
  reason:          z.string().min(10).max(2000),
});
export type RestrictionCreateInput = z.infer<typeof restrictionCreateZ>;

export const eligibilityCheckZ = z.object({
  instructorId:   z.string().uuid(),
  sessionType:    z.enum(['OPC','LPC','RECURRENT','LIFUS','TYPE_RATING','UPRT','EBT']),
  aircraftType:   z.string().min(2).max(32),
  sessionStartAt: z.string().datetime(),
});
export type EligibilityCheckInput = z.infer<typeof eligibilityCheckZ>;
