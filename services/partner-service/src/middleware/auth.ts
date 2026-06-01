import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole =
  | 'GLOBAL_ADMIN'
  | 'COUNTRY_ADMIN'
  | 'MANAGER'
  | 'INSTRUCTOR'
  | 'PILOT'
  | 'PARTNER_ADMIN';

export interface AuthUser {
  id:                string;
  tenantId:          string;
  email:             string;
  role:              UserRole;
  bookingAuthorized: boolean;
  partnerId?:        string | null;
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

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
      partnerId:         (payload.partnerId as string | null | undefined) ?? null,
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

const ROLE_RANK: Record<UserRole, number> = {
  PILOT:         1,
  PARTNER_ADMIN: 2,
  INSTRUCTOR:    3,
  MANAGER:       4,
  COUNTRY_ADMIN: 5,
  GLOBAL_ADMIN:  6,
};

export function requireMinRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      makeError(res, 403, 'FORBIDDEN', 'Insufficient permissions');
      return;
    }
    next();
  };
}
