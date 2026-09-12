import { ClipboardList, Coins, Grid2X2, Home, Moon, ShieldCheck, User, Video } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Logo from "./Logo";

const userNav = [
  { to: "/", label: "首页", icon: Home },
  { to: "/create", label: "AI 视频生成", icon: Video },
  { to: "/tasks", label: "我的任务", icon: ClipboardList },
  { to: "/templates", label: "模板中心", icon: Grid2X2 },
  { to: "/recharge", label: "积分中心", icon: Coins },
  { to: "/profile", label: "个人中心", icon: User },
  { to: "/admin", label: "管理后台", icon: ShieldCheck, adminOnly: true }
];

type SidebarProps = {
  admin?: boolean;
};

function isActive(pathname: string, path: string) {
  if (path === "/") return pathname === "/";
  return pathname === path;
}

export default function Sidebar({ admin = false }: SidebarProps) {
  const location = useLocation();
  const { balance, balanceLoading, isAuthenticated, role } = useAuth();
  const visibleUserNav = userNav.filter((item) => !item.adminOnly || role === "admin");

  return (
    <aside className={`sidebar ${admin ? "sidebar-admin" : ""}`}>
      <Logo />
      <nav className="nav-list">
        {visibleUserNav.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.label} to={item.to} className={isActive(location.pathname, item.to) ? "active" : ""}>
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="credits-card">
          <strong>{isAuthenticated ? (balanceLoading ? "--" : balance ?? 0) : "--"}</strong>
          <span>积分</span>
          <Link to="/recharge" className="credits-action">去充值</Link>
        </div>
        <button className="theme-switch" type="button">
          <Moon size={18} />
          深色模式
        </button>
      </div>
    </aside>
  );
}
