import { z } from 'zod';

export const SESSION_TYPES = ['ITR','RECURRENT','OPC','LPC','LINE_CHECK','UPRT','EBT','FREE_PRACTICE'] as const;
export type SessionType = typeof SESSION_TYPES[number];

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  ITR:           'Initial Type Rating',
  RECURRENT:     'Recurrent Training',
  OPC:           'Operator Proficiency Check',
  LPC:           'Licence Proficiency Check',
  LINE_CHECK:    'Line Check Preparation',
  UPRT:          'Upset Prevention & Recovery',
  EBT:           'Evidence-Based Training',
  FREE_PRACTICE: 'Free Practice',
};

export const CreateReservationSchema = z.object({
  slotId:      z.string().uuid(),
  sessionType: z.enum(SESSION_TYPES).default('RECURRENT'),
  notes:       z.string().max(500).optional(),
  // Admins/instructors must set this to the target pilot's ID.
  // Pilots must leave it unset (backend enforces their own ID).
  forPilotId:  z.string().optional(),
});

export const CreateSimulatorSchema = z.object({
  name:     z.string().min(1),
  type:     z.string().min(1),
  aircraft: z.string().min(1),
  location: z.string().min(1),
  capacity: z.number().int().min(1).max(10).default(1),
});

export const CreateSlotSchema = z.object({
  simulatorId: z.string(),
  startTime:   z.string().datetime(),
  endTime:     z.string().datetime(),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export type CreateSimulatorInput   = z.infer<typeof CreateSimulatorSchema>;
export type CreateSlotInput        = z.infer<typeof CreateSlotSchema>;
