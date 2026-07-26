import DashboardLayout from '@/components/dashboard-layout';
import ProjectDetail from '@/components/project-detail';

export default async function ServicePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return (
    <DashboardLayout>
      <ProjectDetail name={name} />
    </DashboardLayout>
  );
}
