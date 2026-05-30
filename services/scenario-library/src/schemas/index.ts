import { z } from 'zod';

export const scenarioCategoryZ = z.enum(['NORMAL', 'ABNORMAL', 'EMERGENCY', 'LOFT', 'EBT', 'UPRT', 'CRM_FOCUS']);
export const phaseOfFlightZ = z.enum(['PREFLIGHT', 'TAXI', 'TAKEOFF', 'CLIMB', 'CRUISE', 'DESCENT', 'APPROACH', 'LANDING', 'GO_AROUND', 'ALL']);
export const minimumFstdLevelZ = z.enum(['FNPT_II', 'FTD_2', 'FFS_C', 'FFS_D']);

export const scenarioCreateZ = z.object({
  code:             z.string().min(1).max(64),
  title:            z.string().min(1).max(255),
  aircraftType:     z.string().min(2).max(32),
  scenarioCategory: scenarioCategoryZ,
  phaseOfFlight:    phaseOfFlightZ,
  minimumFstdLevel: minimumFstdLevelZ,
  description:      z.string().max(4000).optional(),
  durationMinutes:  z.number().int().min(5).max(480),
});
export type ScenarioCreateInput = z.infer<typeof scenarioCreateZ>;

export const scenarioUpdateZ = z.object({
  title:            z.string().min(1).max(255).optional(),
  description:      z.string().max(4000).optional(),
  durationMinutes:  z.number().int().min(5).max(480).optional(),
  minimumFstdLevel: minimumFstdLevelZ.optional(),
});
export type ScenarioUpdateInput = z.infer<typeof scenarioUpdateZ>;

export const initialConditionCreateZ = z.object({
  airportIcao:    z.string().length(4),
  runway:         z.string().min(2).max(8),
  weightKg:       z.number().int().positive(),
  fuelKg:         z.number().int().nonnegative(),
  cgPercent:      z.number().min(0).max(100),
  weather:        z.object({
    windDir:    z.number().min(0).max(360),
    windKt:     z.number().nonnegative(),
    visMeters:  z.number().nonnegative(),
    ceilingFt:  z.number().nonnegative(),
    tempC:      z.number(),
    qnh:        z.number().positive(),
  }).passthrough(),
  ataChapterRefs: z.array(z.string()).default([]),
});
export type InitialConditionCreateInput = z.infer<typeof initialConditionCreateZ>;

export const injectionCreateZ = z.object({
  sequence:             z.number().int().min(1),
  triggerType:          z.enum(['TIME', 'EVENT', 'PHASE', 'ATC']),
  triggerSpec:          z.record(z.unknown()),
  malfunctionCode:      z.string().min(1).max(32),
  description:          z.string().min(1).max(2000),
  expectedCrewResponse: z.string().min(1).max(2000),
  severity:             z.enum(['NORMAL', 'ABNORMAL', 'EMERGENCY']),
});
export type InjectionCreateInput = z.infer<typeof injectionCreateZ>;

export const competencyMappingCreateZ = z.object({
  competencyUnitCode:    z.enum(['AP', 'COM', 'FPA', 'FPM', 'LT', 'PSD', 'SA', 'WM']),
  weight:                z.number().int().min(1).max(5),
  observableBehaviours:  z.array(z.string().min(1)).max(20),
});
export type CompetencyMappingCreateInput = z.infer<typeof competencyMappingCreateZ>;

export const scenarioApproveZ = z.object({
  authorityReference: z.string().min(1).max(128),
  validFrom:          z.string().date(),
  validUntil:         z.string().date(),
}).refine(d => d.validUntil > d.validFrom, { message: 'validUntil must be after validFrom' });
export type ScenarioApproveInput = z.infer<typeof scenarioApproveZ>;

export const briefTemplateUpsertZ = z.object({
  briefMarkdown:    z.string().min(1).max(20000),
  debriefMarkdown:  z.string().min(1).max(20000),
  instructorNotes:  z.string().max(10000).optional(),
  pilotPrereadRefs: z.array(z.string()).max(50).default([]),
});
export type BriefTemplateUpsertInput = z.infer<typeof briefTemplateUpsertZ>;

export const scenarioSearchZ = z.object({
  competencyUnitCodes: z.array(z.enum(['AP', 'COM', 'FPA', 'FPM', 'LT', 'PSD', 'SA', 'WM'])).min(1),
  aircraftType:        z.string().min(2).max(32),
  minimumFstdLevel:    minimumFstdLevelZ.optional(),
  category:            scenarioCategoryZ.optional(),
});
export type ScenarioSearchInput = z.infer<typeof scenarioSearchZ>;
