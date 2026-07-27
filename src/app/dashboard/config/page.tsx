import DashboardLayout from '@/components/dashboard-layout';
import ConfigPage from '@/components/config-page';

export default async function ConfigDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <ConfigPage initialTab={tab} />
    </DashboardLayout>
  );
}
