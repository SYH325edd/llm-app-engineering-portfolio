import { Bell, Gift, Search } from "lucide-react";
import UserPreviewMenu from "./UserPreviewMenu";

type TopbarProps = {
  admin?: boolean;
  hideUserInfo?: boolean;
};

export default function Topbar({ admin = false, hideUserInfo = false }: TopbarProps) {
  return (
    <header className={`topbar ${admin ? "topbar-admin" : ""}`}>
      {admin ? (
        <label className="top-search">
          <Search size={18} />
          <input placeholder="搜索用户、任务、视频等..." />
        </label>
      ) : (
        <div />
      )}
      <div className="top-actions">
        <button className="icon-btn" type="button" aria-label="礼物">
          <Gift size={20} />
        </button>
        <button className="icon-btn with-dot" type="button" aria-label="通知">
          <Bell size={20} />
        </button>
        {!hideUserInfo ? <UserPreviewMenu /> : null}
      </div>
    </header>
  );
}
