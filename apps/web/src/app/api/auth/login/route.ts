import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  const body = await request.json() as { email: string; password: string };

  const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';

  let upstream: Response;
  try {
    upstream = await fetch(`${userServiceUrl}/api/v1/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { data: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service is unavailable' } },
      { status: 503 }
    );
  }

  const data = await upstream.json() as {
    data: { token: string; user: { firstName: string; lastName: string } } | null;
    error: { code: string; message: string } | null;
  };

  if (!upstream.ok || !data.data) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const cookieStore = await cookies();
  cookieStore.set('aerocap_token', data.data.token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60,
    path:     '/',
    sameSite: 'lax',
  });
  cookieStore.set('aerocap_user', JSON.stringify({
    firstName: data.data.user.firstName,
    lastName:  data.data.user.lastName,
  }), {
    httpOnly: false,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60,
    path:     '/',
    sameSite: 'lax',
  });

  return NextResponse.json({ data: { ok: true } });
}
