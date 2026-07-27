import DashboardLayout from '@/components/dashboard-layout';
import StaticSitesPage from '@/components/static-sites-page';

export default async function StaticSitesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <StaticSitesPage initialTab={tab} />
    </DashboardLayout>
  );
}
