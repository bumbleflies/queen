import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

function getToken(): string | null {
  return localStorage.getItem('queen_token');
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
