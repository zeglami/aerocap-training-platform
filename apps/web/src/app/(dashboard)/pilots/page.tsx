import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/auth';
import PilotsClient from './pilots-client';

export default async function PilotsPage() {
  const user = await getServerUser();

  // Pilots have no business seeing crew management
  if (!user || user.role === 'PILOT') redirect('/dashboard');

  const canAuthorize = user.role === 'GLOBAL_ADMIN' || user.role === 'COUNTRY_ADMIN' || user.role === 'MANAGER';

  return <PilotsClient canAuthorize={canAuthorize} />;
}
