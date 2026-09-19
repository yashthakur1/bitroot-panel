import DashboardLayout from '@/components/dashboard-layout';
import ProjectGroupPage from '@/components/project-group-page';

export default async function ProjectDetailDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <DashboardLayout>
      <ProjectGroupPage id={id} />
    </DashboardLayout>
  );
}
