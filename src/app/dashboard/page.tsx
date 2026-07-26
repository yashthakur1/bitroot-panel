import DashboardLayout from '@/components/dashboard-layout';
import ProjectList from '@/components/project-list';

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <ProjectList />
    </DashboardLayout>
  );
}
