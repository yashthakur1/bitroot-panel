import DashboardLayout from '@/components/dashboard-layout';
import NewStaticForm from '@/components/new-static-form';

export default async function NewStaticPage({
  searchParams,
}: {
  searchParams: Promise<{ env?: string }>;
}) {
  const { env } = await searchParams;
  return (
    <DashboardLayout>
      <NewStaticForm initialEnv={env} />
    </DashboardLayout>
  );
}
