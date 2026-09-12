import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

type PageLayoutProps = {
  children: ReactNode;
  admin?: boolean;
  className?: string;
  showTopbar?: boolean;
  hideUserInfo?: boolean;
};

export default function PageLayout({
  children,
  admin = false,
  className = "",
  showTopbar = true,
  hideUserInfo = false
}: PageLayoutProps) {
  return (
    <div className={`app-shell ${admin ? "admin-shell" : ""}`}>
      <Sidebar admin={admin} />
      <main className={`content-shell ${className}`}>
        {showTopbar ? <Topbar admin={admin} hideUserInfo={hideUserInfo} /> : null}
        {children}
      </main>
    </div>
  );
}
