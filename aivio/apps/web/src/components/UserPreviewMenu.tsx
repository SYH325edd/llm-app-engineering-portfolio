import { Check, ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { UserRole } from "../context/AuthContext";

const roleItems: Array<{ role: UserRole; label: string; caption: string }> = [
  { role: "user", label: "普通用户预览", caption: "仅静态预览" },
  { role: "admin", label: "管理员预览", caption: "仅静态预览" }
];

export default function UserPreviewMenu() {
  const { role, previewRole, user, isAuthenticated, setPreviewRole, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const displayName = user?.nickname || user?.email || (role === "admin" ? "Admin" : "Creator");

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function selectPreviewRole(nextRole: UserRole) {
    if (!isAuthenticated) {
      setPreviewRole(nextRole);
      if (nextRole === "user" && location.pathname === "/admin") {
        navigate("/");
      }
    }
    setOpen(false);
  }

  async function handleLogout() {
    await logout();
    setOpen(false);
    navigate("/login");
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className={`user-chip user-chip-button ${open ? "open" : ""}`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" />
        <div>
          <strong>{role === "admin" ? "Admin" : displayName}</strong>
          <small>{role === "admin" ? "超级管理员" : isAuthenticated ? "普通用户" : "静态预览"}</small>
        </div>
        <ChevronDown size={15} />
      </button>

      {open ? (
        <div className="user-dropdown">
          {roleItems.map((item) => {
            const selected = isAuthenticated ? role === item.role : previewRole === item.role;
            return (
              <button
                className={`${selected ? "selected" : ""} ${isAuthenticated ? "disabled" : ""}`}
                type="button"
                key={item.role}
                onClick={() => selectPreviewRole(item.role)}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{isAuthenticated ? "真实登录后由后端角色决定" : item.caption}</small>
                </span>
                {selected ? <Check size={16} /> : null}
              </button>
            );
          })}
          <button className="logout-item" type="button" onClick={isAuthenticated ? handleLogout : () => setOpen(false)}>
            <span>
              <strong>退出登录</strong>
              <small>{isAuthenticated ? "清理登录状态" : "静态展示"}</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
