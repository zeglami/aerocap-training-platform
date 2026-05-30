import { cache } from 'react';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import type { AuthUser } from '@/types';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production'
);

export const getServerUser = cache(async (): Promise<AuthUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get('aerocap_token')?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id:                (payload.sub ?? payload.id) as string,
      tenantId:          payload.tenantId as string,
      email:             payload.email as string,
      role:              payload.role as AuthUser['role'],
      firstName:         (payload.firstName as string) ?? '',
      lastName:          (payload.lastName  as string) ?? '',
      bookingAuthorized: (payload.bookingAuthorized as boolean) ?? false,
      managerRegions:    payload.managerRegions as AuthUser['managerRegions'],
      managerHomeTenant: payload.managerHomeTenant as string | undefined,
    };
  } catch {
    return null;
  }
});

export async function getServerToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('aerocap_token')?.value ?? null;
}
