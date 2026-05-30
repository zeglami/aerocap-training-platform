import { z } from 'zod';

export const reportTemplateCreateZ = z.object({
  code:                z.string().min(1).max(64),
  title:               z.string().min(1).max(255),
  regulatoryFramework: z.enum(['EASA', 'FAA', 'SACAA', 'DGCA', 'CAAC', 'INTERNAL']),
  templateType:        z.enum(['PILOT_COMPLIANCE', 'FLEET_COMPLIANCE', 'AUTHORITY_AUDIT', 'INCIDENT_PACKAGE', 'TRAINING_LOG_EXTRACT']),
  layoutSpec:          z.record(z.unknown()),
  isAuthorityApproved: z.boolean().default(false),
  authorityApprovalRef: z.string().max(128).optional(),
});
export type ReportTemplateCreateInput = z.infer<typeof reportTemplateCreateZ>;

export const reportTemplateUpdateZ = z.object({
  title:               z.string().min(1).max(255).optional(),
  layoutSpec:          z.record(z.unknown()).optional(),
  isAuthorityApproved: z.boolean().optional(),
  authorityApprovalRef: z.string().max(128).optional(),
});
export type ReportTemplateUpdateInput = z.infer<typeof reportTemplateUpdateZ>;

export const reportRunCreateZ = z.object({
  templateId: z.string().uuid(),
  scope: z.object({
    pilotIds:            z.array(z.string().uuid()).optional(),
    fleetTypes:          z.array(z.string()).optional(),
    dateFrom:            z.string().date().optional(),
    dateTo:              z.string().date().optional(),
    includeWaivedDeficits: z.boolean().default(true),
  }).refine(
    s => (s.pilotIds?.length ?? 0) > 0 || (s.fleetTypes?.length ?? 0) > 0,
    { message: 'Must scope to pilots or fleet' },
  ),
  outputFormats: z.array(z.enum(['PDF', 'JSON', 'CSV', 'XML'])).min(1).default(['PDF']),
});
export type ReportRunCreateInput = z.infer<typeof reportRunCreateZ>;

export const snapshotRefreshZ = z.object({
  forceRecompute: z.boolean().default(false),
});
export type SnapshotRefreshInput = z.infer<typeof snapshotRefreshZ>;

export const inspectorTokenCreateZ = z.object({
  inspectorEmail: z.string().email(),
  inspectorName:  z.string().min(1).max(255),
  authority:      z.string().min(1).max(128),
  scope: z.object({
    pilotIds:        z.array(z.string().uuid()).optional(),
    fleetTypes:      z.array(z.string()).optional(),
    reportTemplates: z.array(z.string().uuid()).optional(),
  }),
  validForHours: z.number().int().min(1).max(168),
});
export type InspectorTokenCreateInput = z.infer<typeof inspectorTokenCreateZ>;

export const inspectorAuthZ = z.object({
  token: z.string().min(40).max(255),
});
export type InspectorAuthInput = z.infer<typeof inspectorAuthZ>;
