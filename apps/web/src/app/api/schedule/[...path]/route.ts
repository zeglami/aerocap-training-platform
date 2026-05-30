import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const SVC = process.env.SCHEDULE_SERVICE_URL ?? 'http://localhost:3011';

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const token    = (await cookies()).get('aerocap_token')?.value;
  const upstream = `${SVC}/api/v1/${path.join('/')}${req.nextUrl.search}`;
  const body     = req.method !== 'GET' && req.method !== 'DELETE' ? await req.text() : undefined;

  try {
    const res = await fetch(upstream, {
      method:  req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { data: null, meta: {}, error: { code: 'SERVICE_UNAVAILABLE', message: 'schedule-service is offline' } },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
