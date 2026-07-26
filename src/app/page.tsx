import LoginForm from '@/components/login-form';

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 border rounded-lg p-8 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
