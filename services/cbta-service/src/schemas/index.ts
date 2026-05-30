import { z } from 'zod';

export const CreateAssessmentSchema = z.object({
  pilotId:           z.string(),
  competencyUnitId:  z.string(),
  score:             z.number().int().min(1).max(5),
  markers:           z.array(z.string()).optional(),
  notes:             z.string().max(2000).optional(),
  assessedAt:        z.string().datetime().optional(),
});

export const BulkAssessmentSchema = z.object({
  pilotId:     z.string(),
  assessedAt:  z.string().datetime().optional(),
  scores: z.array(z.object({
    competencyUnitId: z.string(),
    score:            z.number().int().min(1).max(5),
    notes:            z.string().max(500).optional(),
  })),
});

export type CreateAssessmentInput = z.infer<typeof CreateAssessmentSchema>;
export type BulkAssessmentInput   = z.infer<typeof BulkAssessmentSchema>;
