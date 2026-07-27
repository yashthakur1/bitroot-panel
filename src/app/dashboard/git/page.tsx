import DashboardLayout from '@/components/dashboard-layout';
import GitConnectionsPage from '@/components/git-connections-page';

export default async function GitConnectionsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <GitConnectionsPage initialTab={tab} />
    </DashboardLayout>
  );
}
