import { Bell, Gift, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import UserPreviewMenu from "./UserPreviewMenu";
import { applyInviteCode, getInviteInfo } from "../lib/invite";

type TopbarProps = {
  admin?: boolean;
  hideUserInfo?: boolean;
};

export default function Topbar({ admin = false, hideUserInfo = false }: TopbarProps) {
  const { isAuthenticated, redeemGiftCard, refreshBalance } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteInfo, setInviteInfo] = useState<Awaited<ReturnType<typeof getInviteInfo>> | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");

  async function redeem() {
    if (!code.trim()) { setMessage("请输入礼品卡 ID。"); return; }
    setSubmitting(true); setMessage("");
    try {
      const result = await redeemGiftCard(code.trim());
      setMessage(`兑换成功，已增加 ${result.addedCredits} 积分。`); setCode("");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "兑换失败，请稍后重试。");
    } finally { setSubmitting(false); }
  }

  async function openInvite() {
    setInviteOpen(true); setInviteMessage("");
    try { setInviteInfo(await getInviteInfo()); } catch (error) { setInviteMessage(error instanceof ApiError ? error.message : "邀请信息加载失败，请稍后重试。"); }
  }

  async function applyInvite() {
    try { const result = await applyInviteCode(inviteCode.trim()); await refreshBalance(); setInviteMessage(`填写成功，已获得 ${result.addedCredits} 积分。`); setInviteInfo(await getInviteInfo()); setInviteCode(""); }
    catch (error) { setInviteMessage(error instanceof ApiError ? error.message : "邀请码填写失败，请稍后重试。"); }
  }

  async function copyInviteCode() {
    if (!inviteInfo?.inviteCode) return;
    try { await navigator.clipboard.writeText(inviteInfo.inviteCode); setInviteMessage("邀请码已复制。"); } catch { setInviteMessage("复制失败，请手动复制。"); }
  }

  return (
    <>
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
        <button className="icon-btn" type="button" aria-label="邀请好友" onClick={() => void openInvite()}><UserPlus size={20} /></button>
        <button className="icon-btn" type="button" aria-label="礼物" onClick={() => { setMessage(""); setOpen(true); }}>
          <Gift size={20} />
        </button>
        <button className="icon-btn with-dot" type="button" aria-label="通知">
          <Bell size={20} />
        </button>
        {!hideUserInfo ? <UserPreviewMenu /> : null}
      </div>
    </header>
    {inviteOpen ? <div className="gift-card-modal-backdrop" role="presentation" onMouseDown={() => setInviteOpen(false)}>
      <section className="gift-card-modal invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="gift-card-close" type="button" aria-label="关闭" onClick={() => setInviteOpen(false)}>×</button>
        <h2 id="invite-title">邀请好友</h2>
        {inviteInfo?.canApply ? <div className="invite-section"><h3>填写邀请码</h3><div className="invite-apply-row"><input value={inviteCode} maxLength={6} placeholder="填写邀请码" onChange={(event) => setInviteCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))} /><button className="admin-action primary" type="button" onClick={() => void applyInvite()}>确认填写</button></div></div> : null}
        <div className="invite-section"><h3>我的邀请码</h3><div className="invite-code-row"><strong>{inviteInfo?.inviteCode || "加载中…"}</strong><button className="admin-action" type="button" disabled={!inviteInfo?.inviteCode} onClick={() => void copyInviteCode()}>复制</button></div></div>
        {inviteMessage ? <p className="gift-card-message">{inviteMessage}</p> : null}
      </section>
    </div> : null}
    {open ? <div className="gift-card-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="gift-card-modal" role="dialog" aria-modal="true" aria-labelledby="gift-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="gift-card-close" type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
        <h2 id="gift-card-title">兑换礼品卡</h2>
        <input autoFocus value={code} placeholder="请输入礼品卡 ID" onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void redeem(); }} />
        <button className="admin-action primary gift-card-submit" type="button" disabled={submitting || !isAuthenticated} onClick={() => void redeem()}>{submitting ? "兑换中…" : "兑换"}</button>
        {message ? <p className={`gift-card-message ${message.startsWith("兑换成功") ? "success" : "error"}`}>{message}</p> : null}
      </section>
    </div> : null}
    </>
  );
}
