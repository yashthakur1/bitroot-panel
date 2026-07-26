import DashboardLayout from '@/components/dashboard-layout';
import ProjectDetail from '@/components/project-detail';

export default async function ServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { name } = await params;
  const { tab } = await searchParams;
  return (
    <DashboardLayout>
      <ProjectDetail name={name} initialTab={tab} />
    </DashboardLayout>
  );
}
