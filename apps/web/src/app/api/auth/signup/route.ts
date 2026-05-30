import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const USER_SVC = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';

export async function POST(request: NextRequest) {
  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${USER_SVC}/api/v1/auth/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
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

  // Set auth cookie same as login — pilot can immediately access their account
  const cookieStore = await cookies();
  cookieStore.set('aerocap_token', data.data.token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60,
    path:     '/',
    sameSite: 'lax',
  });

  return NextResponse.json({ data: { ok: true } }, { status: 201 });
}

// Public: country list for the signup picker
export async function GET() {
  try {
    const res  = await fetch(`${USER_SVC}/api/v1/countries`);
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { data: [], error: { code: 'SERVICE_UNAVAILABLE', message: 'Cannot load countries' } },
      { status: 503 }
    );
  }
}
