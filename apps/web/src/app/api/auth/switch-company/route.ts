import { NextRequest, NextResponse } from 'next/server';
import { getServerToken } from '@/lib/auth';

const USER_SVC = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';
const EXPIRED  = 'Thu, 01 Jan 1970 00:00:00 GMT';

export async function POST(request: NextRequest) {
  const token = await getServerToken();
  if (!token) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } }, { status: 401 });

  const body = await request.json() as { region: string };

  let upstream: Response;
  try {
    upstream = await fetch(`${USER_SVC}/api/v1/auth/switch-company`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' } }, { status: 503 });
  }

  const data = await upstream.json() as { data: { token: string; region: string } | null; error: unknown };
  if (!upstream.ok || !data.data) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const res = NextResponse.json({ data: { ok: true, region: data.data.region } });
  // Replace the session cookie with the new scoped JWT
  res.headers.append('Set-Cookie', `aerocap_token=; Path=/; Expires=${EXPIRED}; HttpOnly; SameSite=Lax`);
  res.headers.append('Set-Cookie',
    `aerocap_token=${data.data.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8 * 60 * 60}`
  );
  return res;
}
