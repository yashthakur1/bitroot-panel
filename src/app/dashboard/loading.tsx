import DashboardLayout from '@/components/dashboard-layout';
import { PageSkeleton } from '@/components/skeletons';

export default function DashboardLoading() {
  return (
    <DashboardLayout>
      <PageSkeleton />
    </DashboardLayout>
  );
}
