import DashboardLayout from '@/components/dashboard-layout';
import StaticSiteDetail from '@/components/static-site-detail';

export default async function StaticSitePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return (
    <DashboardLayout>
      <StaticSiteDetail name={name} />
    </DashboardLayout>
  );
}
