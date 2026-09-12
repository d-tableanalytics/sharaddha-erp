import { Navigate, Outlet } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { Loader2 } from 'lucide-react';

export const ProtectedRoute = () => {
  const { user, loading } = useUserStore();

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <Loader2 className="animate-spin text-primary-600" size={32} />
        <span className="text-sm font-semibold text-slate-600 select-none">
          Loading portal credentials...
        </span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
