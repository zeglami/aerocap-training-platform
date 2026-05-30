import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { AuthProvider } from '@/components/auth-context';
import { getServerUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser();
  if (!user) redirect('/login');

  const displayName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;

  return (
    <AuthProvider user={user}>
      <div className="flex min-h-screen">
        <Sidebar
          userName={displayName}
          userRole={user.role}
          tenantId={user.tenantId}
          managerRegions={user.managerRegions}
        />
        <main className="flex-1 ml-60 p-8 overflow-auto">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
