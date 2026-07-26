import DashboardLayout from '@/components/dashboard-layout';
import NewProjectForm from '@/components/new-project-form';

export default async function NewServicePage({
  searchParams,
}: {
  searchParams: Promise<{ env?: string }>;
}) {
  const { env } = await searchParams;
  return (
    <DashboardLayout>
      <NewProjectForm initialEnv={env} />
    </DashboardLayout>
  );
}
