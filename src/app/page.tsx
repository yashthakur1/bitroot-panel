import LoginForm from '@/components/login-form';

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border rounded-lg p-8 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
