import { z } from 'zod';

export const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
});

export const SignupSchema = z.object({
  email:     z.string().email(),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName:  z.string().min(1, 'Last name is required'),
  tenantId:  z.string().min(1, 'Organisation is required'),
});

export const REGIONS = ['FR', 'ZA', 'CN', 'IN'] as const;
export type Region = typeof REGIONS[number];

export const CreateUserSchema = z.object({
  email:          z.string().email(),
  password:       z.string().min(8, 'Password must be at least 8 characters'),
  firstName:      z.string().min(1),
  lastName:       z.string().min(1),
  role:           z.enum(['COUNTRY_ADMIN', 'INSTRUCTOR', 'PILOT', 'MANAGER']),
  managerScope:   z.union([
    z.literal('GLOBAL'),
    z.array(z.enum(REGIONS)).min(1),
  ]).optional(),
}).refine(d => d.role !== 'MANAGER' || d.managerScope !== undefined, {
  message: 'managerScope is required when role is MANAGER',
  path: ['managerScope'],
});

export const UpdateUserSchema = z.object({
  firstName:    z.string().min(1).optional(),
  lastName:     z.string().min(1).optional(),
  role:         z.enum(['COUNTRY_ADMIN', 'INSTRUCTOR', 'PILOT', 'MANAGER']).optional(),
  managerScope: z.union([z.literal('GLOBAL'), z.array(z.enum(REGIONS)).min(1)]).optional(),
});

export const SwitchCompanySchema = z.object({
  region: z.enum(REGIONS),
});

export const CreateTenantSchema = z.object({
  name:   z.string().min(1),
  slug:   z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  region: z.enum(['FR', 'ZA', 'CN', 'IN']),
  plan:   z.enum(['STANDARD', 'ENTERPRISE']).default('STANDARD'),
});

export type LoginInput          = z.infer<typeof LoginSchema>;
export type SignupInput          = z.infer<typeof SignupSchema>;
export type CreateUserInput     = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput     = z.infer<typeof UpdateUserSchema>;
export type CreateTenantInput   = z.infer<typeof CreateTenantSchema>;
export type SwitchCompanyInput  = z.infer<typeof SwitchCompanySchema>;
