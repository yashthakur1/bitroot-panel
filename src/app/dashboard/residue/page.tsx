import DashboardLayout from '@/components/dashboard-layout';
import ResiduePage from '@/components/residue-page';

export default async function ResidueDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <ResiduePage initialTab={tab} />
    </DashboardLayout>
  );
}
