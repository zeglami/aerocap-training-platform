import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole = 'GLOBAL_ADMIN' | 'COUNTRY_ADMIN' | 'CFI' | 'INSTRUCTOR' | 'TRE' | 'PILOT';

export interface AuthUser {
  id:       string;
  tenantId: string;
  email:    string;
  role:     UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
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
      id:       (payload.sub ?? payload.id) as string,
      tenantId: payload.tenantId as string,
      email:    payload.email as string,
      role:     payload.role as UserRole,
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

/** Returns true when the user holds an elevated operations role. */
export function isCfiOrAbove(role: UserRole): boolean {
  return ['GLOBAL_ADMIN', 'CFI', 'TRE'].includes(role);
}
