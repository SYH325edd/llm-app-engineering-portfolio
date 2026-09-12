import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "../context/AuthContext";
import AdminDashboardPage from "../features/admin/pages/AdminDashboardPage";
import CreatePage from "../features/generation/pages/CreatePage";
import DashboardPage from "../features/dashboard/pages/DashboardPage";
import LoginPage from "../features/auth/pages/LoginPage";
import NoPermissionPage from "../features/admin/pages/NoPermissionPage";
import ProfilePage from "../features/profile/pages/ProfilePage";
import RechargePage from "../features/billing/pages/RechargePage";
import RegisterPage from "../features/auth/pages/RegisterPage";
import TasksPage from "../features/tasks/pages/TasksPage";
import TemplateCenterPage from "../features/templates/pages/TemplateCenterPage";

function LoadingPage() {
  return <div className="route-loading">正在恢复登录状态...</div>;
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingPage />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequireAdmin() {
  const { role } = useAuth();
  return role === "admin" ? <AdminDashboardPage /> : <NoPermissionPage />;
}

function PublicOnly({ children }: { children: ReactElement }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/create" element={<RequireAuth><CreatePage /></RequireAuth>} />
      <Route path="/tasks" element={<RequireAuth><TasksPage /></RequireAuth>} />
      <Route path="/templates" element={<RequireAuth><TemplateCenterPage /></RequireAuth>} />
      <Route path="/recharge" element={<RequireAuth><RechargePage /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><RequireAdmin /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
