import { ClipboardList, Coins, Headphones, Lock, Shield, Settings, UserRound, Video } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import StatCard from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { changePassword, getNotificationSettings, getProfileRecords, saveNotificationSettings } from "../lib/profile";
import type { NotificationSettings, ProfileRecord } from "../lib/profile";
import { getDefaultDateRange, normalizeDateRangeForQuery } from "../utils/date-filters";

type Tab = "all" | "consume" | "recharge" | "account" | "security" | "notifications";
const tabs: Array<[Tab, string]> = [["all", "积分流水"], ["consume", "消费记录"], ["recharge", "充值记录"], ["account", "账户设置"], ["security", "安全设置"], ["notifications", "通知设置"]];
const defaultRecordFilters = () => ({ ...getDefaultDateRange(), type: "all", keyword: "", direction: "all" });
function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "暂无"; }
function typeLabel(type: string) { return ({ recharge: "充值", consume: "消费", refund: "退款", invitee_reward: "邀请奖励", inviter_reward: "邀请奖励", gift_card_redeem: "礼品卡", admin_adjust: "管理员调整", system_grant: "系统发放" } as Record<string, string>)[type] || type; }

export default function ProfilePage() {
  const { balance, balanceLoading, user } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [records, setRecords] = useState<ProfileRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [filters, setFilters] = useState(defaultRecordFilters);
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [settings, setSettings] = useState<NotificationSettings>({ taskCompleted: true, taskFailed: true, creditChanged: true, systemAnnouncement: true });
  const [settingsMessage, setSettingsMessage] = useState("");

  useEffect(() => {
    if (!["all", "consume", "recharge"].includes(tab)) return;
    setLoading(true); setRecordError("");
    const dateRange = normalizeDateRangeForQuery(appliedFilters.startDate, appliedFilters.endDate);
    void getProfileRecords({ page, pageSize: 10, tab, startDate: dateRange.startDate, endDate: dateRange.endDate, type: tab === "all" ? appliedFilters.type : "all", keyword: appliedFilters.keyword, direction: appliedFilters.direction })
      .then((result) => { setRecords(result.records); setTotal(result.total); })
      .catch((error) => setRecordError(error instanceof Error ? error.message : "记录加载失败。"))
      .finally(() => setLoading(false));
  }, [tab, page, appliedFilters]);

  useEffect(() => { if (tab === "notifications") void getNotificationSettings().then(setSettings).catch(() => undefined); }, [tab]);
  function switchTab(next: Tab) { setTab(next); if (next !== tab) setPage(1); }
  function searchRecords(event: FormEvent) { event.preventDefault(); const dateRange = normalizeDateRangeForQuery(filters.startDate, filters.endDate); const next = { ...filters, ...dateRange }; setFilters(next); setPage(1); setAppliedFilters(next); }
  function resetFilters() { const defaults = defaultRecordFilters(); setFilters(defaults); setAppliedFilters(defaults); setPage(1); }
  async function submitPassword(event: FormEvent) { event.preventDefault(); setPasswordMessage(""); setPasswordError(""); if (!password.next) { setPasswordError("新密码不能为空。"); return; } if (password.next !== password.confirm) { setPasswordError("两次输入的新密码不一致。"); return; } try { await changePassword(password.current, password.next); setPasswordMessage("密码修改成功。"); setPassword({ current: "", next: "", confirm: "" }); } catch (error) { setPasswordError(error instanceof Error ? error.message : "密码修改失败。"); } }
  async function toggleSetting(key: keyof NotificationSettings) { const next = { ...settings, [key]: !settings[key] }; setSettings(next); try { await saveNotificationSettings(next); setSettingsMessage("通知设置已保存。"); } catch (error) { setSettings(settings); setSettingsMessage(error instanceof Error ? error.message : "通知设置保存失败。"); } }

  return <PageLayout hideUserInfo>
    <section className="page-head"><h1>个人中心</h1></section>
    <section className="profile-grid"><div className="profile-main">
      <Card className="profile-hero"><span className="profile-avatar" /><div><h2>{user?.nickname || user?.email || "Creator"}</h2><p>ID: {user?.id || "暂无"} <b /> {user?.email || "未登录"}</p><p>账号状态：{user?.status || "未知"} <b /> 加入时间：{formatTime(user?.createdAt)}</p></div><div className="profile-3d" /></Card>
      <Card className="profile-stats"><StatCard icon={<Coins />} label="当前积分" value={balanceLoading ? "--" : String(balance ?? user?.balance ?? 0)} /><StatCard icon={<ClipboardList />} label="已完成任务" value="28" /><StatCard icon={<Video />} label="生成视频" value="26" /><StatCard icon={<UserRound />} label="成功率" value="98%" /></Card>
      <div className="tabs-row profile-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} type="button" onClick={() => switchTab(key)}>{label}</button>)}</div>
      {tab === "all" || tab === "consume" || tab === "recharge" ? <RecordsPanel tab={tab} records={records} total={total} page={page} loading={loading} error={recordError} filters={filters} setFilters={setFilters} search={searchRecords} reset={resetFilters} setPage={setPage} /> : null}
      {tab === "account" ? <Card className="profile-setting-card"><h3><Settings size={18} />账户设置</h3><form className="profile-password-form" onSubmit={submitPassword}><label>原密码<input type="password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} /></label><label>新密码<input type="password" value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} /></label><label>确认新密码<input type="password" value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} /></label>{passwordError ? <p className="data-error">{passwordError}</p> : null}{passwordMessage ? <p className="profile-success">{passwordMessage}</p> : null}<button className="admin-action primary" type="submit">保存修改</button></form></Card> : null}
      {tab === "security" ? <Card className="profile-setting-card"><h3><Shield size={18} />安全设置</h3><div className="profile-security-list"><p>当前账号邮箱：<strong>{user?.email || "暂无"}</strong></p><p>邮箱验证状态：<strong>{user?.emailVerifiedAt ? "已验证" : "未验证"}</strong></p><p><Lock size={16} />密码已使用安全加密存储，修改密码请前往账户设置。</p></div></Card> : null}
      {tab === "notifications" ? <Card className="profile-setting-card"><h3><Settings size={18} />通知设置</h3><div className="profile-notification-list"><SettingToggle label="任务完成通知" checked={settings.taskCompleted} onChange={() => void toggleSetting("taskCompleted")} /><SettingToggle label="任务失败通知" checked={settings.taskFailed} onChange={() => void toggleSetting("taskFailed")} /><SettingToggle label="积分变动通知" checked={settings.creditChanged} onChange={() => void toggleSetting("creditChanged")} /><SettingToggle label="系统公告通知" checked={settings.systemAnnouncement} onChange={() => void toggleSetting("systemAnnouncement")} /></div>{settingsMessage ? <p className="profile-success">{settingsMessage}</p> : null}</Card> : null}
    </div><aside className="profile-side"><MembershipCard balance={balance ?? user?.balance ?? 0} memberLevel={user?.memberLevel} /><Card className="help-card"><div><h3>需要帮助？</h3><p>如果你在使用过程中遇到问题，可以随时联系我们的客服团队。</p><button>联系客服</button></div><Headphones size={86} /></Card></aside></section>
  </PageLayout>;
}

function RecordsPanel(props: { tab: Tab; records: ProfileRecord[]; total: number; page: number; loading: boolean; error: string; filters: { startDate: string; endDate: string; type: string; keyword: string; direction: string }; setFilters: (value: any) => void; search: (event: FormEvent) => void; reset: () => void; setPage: (value: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(props.total / 10));
  return <Card className="credit-table-card profile-records-card"><form className="profile-record-filters" onSubmit={props.search}><input type="date" value={props.filters.startDate} onChange={(event) => props.setFilters({ ...props.filters, startDate: event.target.value })} /><input type="date" value={props.filters.endDate} onChange={(event) => props.setFilters({ ...props.filters, endDate: event.target.value })} /><select value={props.filters.type} disabled={props.tab !== "all"} onChange={(event) => props.setFilters({ ...props.filters, type: event.target.value })}><option value="all">全部类型</option><option value="consume">消费</option><option value="recharge">充值</option><option value="invite">邀请奖励</option><option value="gift_card">礼品卡</option><option value="refund">退款</option></select><input placeholder="搜索订单号、任务ID或备注" value={props.filters.keyword} onChange={(event) => props.setFilters({ ...props.filters, keyword: event.target.value })} /><select value={props.filters.direction} onChange={(event) => props.setFilters({ ...props.filters, direction: event.target.value })}><option value="all">全部方向</option><option value="increase">增加</option><option value="decrease">扣除</option></select><button className="admin-action primary" type="submit">搜索</button><button className="admin-action muted" type="button" onClick={props.reset}>重置</button></form>{props.error ? <p className="data-error">{props.error}</p> : null}<table className="credit-table"><thead><tr><th>类型</th><th>积分变化</th><th>变化前</th><th>变化后</th><th>备注</th><th>时间</th></tr></thead><tbody>{props.records.map((log) => <tr key={log.id}><td><strong>{typeLabel(log.type)}</strong><small>{log.type}</small></td><td className={log.amount >= 0 ? "green" : "red"}>{log.amount > 0 ? `+${log.amount}` : log.amount}</td><td>{log.balanceBefore}</td><td>{log.balanceAfter}</td><td>{log.remark || "暂无"}</td><td>{formatTime(log.createdAt)}</td></tr>)}</tbody></table>{props.loading ? <div className="empty-state">记录加载中...</div> : null}{!props.loading && !props.records.length ? <div className="empty-state">暂无记录</div> : null}<div className="pagination centered"><button disabled={props.page <= 1 || props.loading} onClick={() => props.setPage(props.page - 1)}>上一页</button><span>{props.page} / {totalPages}</span><button disabled={props.page >= totalPages || props.loading} onClick={() => props.setPage(props.page + 1)}>下一页</button></div></Card>;
}

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className="profile-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={onChange} /><i /></label>; }

function MembershipCard({ balance, memberLevel }: { balance: number; memberLevel?: string }) {
  const target = 50000;
  const svip = memberLevel === "svip" || balance >= target;
  const progress = Math.min(100, Math.max(0, (balance / target) * 100));
  return <Card className="member-card"><div className="card-title-row"><h3>会员中心</h3></div><div className="member-progress"><strong>当前等级：{svip ? "SVIP用户" : "普通用户"}</strong><span>升级权益：更低价格，更快返图，更优先的生成体验</span><i style={{ background: `linear-gradient(90deg, #2f7cff ${progress}%, #d4e5ff ${progress}%)` }} /><p>{svip ? "已达到 SVIP 等级" : `升级还需 ${Math.max(0, target - balance)} 积分`} <b>{balance} / {target}</b></p></div></Card>;
}
