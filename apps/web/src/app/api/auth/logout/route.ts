import { NextResponse } from 'next/server';

const EXPIRED = 'Thu, 01 Jan 1970 00:00:00 GMT';

export async function POST() {
  const res = NextResponse.json({ data: { ok: true } });
  res.headers.append('Set-Cookie', `aerocap_token=; Path=/; Expires=${EXPIRED}; HttpOnly; SameSite=Lax`);
  res.headers.append('Set-Cookie', `aerocap_user=; Path=/; Expires=${EXPIRED}; SameSite=Lax`);
  return res;
}
