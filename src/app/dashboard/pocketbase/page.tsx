import DashboardLayout from '@/components/dashboard-layout';
import PocketBasePage from '@/components/pocketbase-page';

export default async function PocketBaseDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <PocketBasePage initialTab={tab} />
    </DashboardLayout>
  );
}
