import { z } from 'zod';

export const PARTNER_TYPES = ['AIRLINE','MILITARY','TRAINING_ACADEMY','CORPORATE','CHARTER'] as const;
export const PARTNER_STATUSES = ['ACTIVE','SUSPENDED','EXPIRED'] as const;
export const MEMBER_ROLES = ['PILOT','PARTNER_ADMIN','PARTNER_COORDINATOR'] as const;

export const CreatePartnerSchema = z.object({
  name:          z.string().min(2).max(255),
  icaoCode:      z.string().min(2).max(8).toUpperCase().optional(),
  type:          z.enum(PARTNER_TYPES),
  contactName:   z.string().min(1).max(255),
  contactEmail:  z.string().email(),
  contractRef:   z.string().max(100).optional(),
  contractStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  contractEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxPilots:     z.number().int().positive().nullable().optional(),
  notes:         z.string().max(4000).optional(),
});
export type CreatePartnerInput = z.infer<typeof CreatePartnerSchema>;

export const UpdatePartnerSchema = z.object({
  name:         z.string().min(2).max(255).optional(),
  contactName:  z.string().max(255).optional(),
  contactEmail: z.string().email().optional(),
  status:       z.enum(PARTNER_STATUSES).optional(),
  contractEnd:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  maxPilots:    z.number().int().positive().nullable().optional(),
  notes:        z.string().max(4000).nullable().optional(),
}).strict();
export type UpdatePartnerInput = z.infer<typeof UpdatePartnerSchema>;

export const AddMemberSchema = z.object({
  userId:     z.string().uuid(),
  memberRole: z.enum(MEMBER_ROLES).default('PILOT'),
  notes:      z.string().max(1000).optional(),
});
export type AddMemberInput = z.infer<typeof AddMemberSchema>;

export const PaginationSchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
