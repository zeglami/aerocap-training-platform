import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole = 'GLOBAL_ADMIN' | 'COUNTRY_ADMIN' | 'INSTRUCTOR' | 'PILOT';

export interface AuthUser {
  id:                string;
  tenantId:          string;
  email:             string;
  role:              UserRole;
  bookingAuthorized: boolean;
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser; }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

function e(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ data: null, meta: { requestId: '', timestamp: new Date().toISOString() }, error: { code, message } });
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) { e(res, 401, 'UNAUTHORIZED', 'Missing token'); return; }
  try {
    const p = jwt.verify(h.slice(7), JWT_SECRET) as Record<string, unknown>;
    req.user = {
      id:                (p.sub ?? p.id) as string,
      tenantId:          p.tenantId as string,
      email:             p.email as string,
      role:              p.role as UserRole,
      bookingAuthorized: (p.bookingAuthorized as boolean) ?? false,
    };
    next();
  } catch { e(res, 401, 'UNAUTHORIZED', 'Invalid or expired token'); }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      e(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
    }
    next();
  };
}
