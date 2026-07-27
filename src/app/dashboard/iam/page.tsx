import DashboardLayout from '@/components/dashboard-layout';
import IamPage from '@/components/iam-page';

export default async function IamDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <IamPage initialTab={tab} />
    </DashboardLayout>
  );
}
