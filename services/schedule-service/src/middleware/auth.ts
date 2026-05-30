import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole = 'GLOBAL_ADMIN' | 'COUNTRY_ADMIN' | 'MANAGER' | 'INSTRUCTOR' | 'PILOT';

export interface AuthUser {
  id:                string;
  tenantId:          string;
  email:             string;
  role:              UserRole;
  bookingAuthorized: boolean;
  managerRegions?:   string[] | null;
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

const ROLE_RANK: Record<UserRole, number> = {
  PILOT: 1, INSTRUCTOR: 2, MANAGER: 3, COUNTRY_ADMIN: 4, GLOBAL_ADMIN: 5,
};

function makeError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    data: null,
    meta: { requestId: '', timestamp: new Date().toISOString() },
    error: { code, message },
  });
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    makeError(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as Record<string, unknown>;
    req.user = {
      id:                (payload.sub ?? payload.id) as string,
      tenantId:          payload.tenantId as string,
      email:             payload.email as string,
      role:              payload.role as UserRole,
      bookingAuthorized: (payload.bookingAuthorized as boolean) ?? false,
      managerRegions:    payload.managerRegions as string[] | null | undefined,
    };
    next();
  } catch {
    makeError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      makeError(res, 403, 'FORBIDDEN', 'Insufficient permissions');
      return;
    }
    next();
  };
}

export function requireMinRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      makeError(res, 403, 'FORBIDDEN', 'Insufficient permissions');
      return;
    }
    next();
  };
}
