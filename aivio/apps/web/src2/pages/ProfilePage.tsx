import { ClipboardList, Coins, Headphones, Shield, Settings, UserRound, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import StatCard from "../components/StatCard";
import { useAuth } from "../context/AuthContext";

function formatTime(value?: string | null) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    recharge: "充值",
    consume: "生成消耗",
    refund: "失败退款",
    admin_adjust: "管理员调整",
    system_grant: "系统发放"
  };
  return labels[type] || type;
}

export default function ProfilePage() {
  const { balance, balanceError, balanceLoading, creditLogs, creditLogsError, creditLogsLoading, user } = useAuth();
  const quickLinks: Array<[LucideIcon, string]> = [
    [ClipboardList, "我的任务"],
    [Video, "模板中心"],
    [Coins, "积分充值"],
    [Coins, "消费记录"],
    [Settings, "账户设置"],
    [Shield, "安全设置"]
  ];

  return (
    <PageLayout hideUserInfo>
      <section className="page-head"><h1>个人中心</h1></section>
      <section className="profile-grid">
        <div className="profile-main">
          <Card className="profile-hero">
            <span className="profile-avatar" />
            <div>
              <h2>{user?.nickname || user?.email || "Creator"} <em>{user?.role === "admin" ? "超级管理员" : "普通用户"}</em></h2>
              <p>ID: {user?.id || "暂无"} <b /> {user?.email || "未登录"}</p>
              <p>账号状态：{user?.status || "未知"} <b /> 加入时间：{formatTime(user?.createdAt)}</p>
            </div>
            <div className="profile-3d" />
          </Card>
          <Card className="profile-stats">
            <StatCard icon={<Coins />} label="当前积分" value={balanceLoading ? "--" : String(balance ?? user?.balance ?? 0)} />
            <StatCard icon={<ClipboardList />} label="已完成任务" value="28" />
            <StatCard icon={<Video />} label="生成视频" value="26" />
            <StatCard icon={<UserRound />} label="成功率" value="98%" />
          </Card>
          <div className="tabs-row profile-tabs">{["积分流水", "消费记录", "充值记录", "账户设置", "安全设置", "通知设置"].map((tab, i) => <button className={i === 0 ? "active" : ""} key={tab}>{tab}</button>)}</div>
          <Card className="credit-table-card">
            {balanceError ? <p className="data-error">{balanceError}</p> : null}
            {creditLogsError ? <p className="data-error">{creditLogsError}</p> : null}
            <table className="credit-table">
              <thead><tr><th>类型</th><th>积分变动</th><th>变动前</th><th>变动后</th><th>备注</th><th>时间</th></tr></thead>
              <tbody>
                {creditLogs.map((log) => (
                  <tr key={log.id}>
                    <td><strong>{typeLabel(log.type)}</strong><small>{log.type}</small></td>
                    <td className={log.amount >= 0 ? "green" : "red"}>
                      <span className={`log-dot ${log.amount >= 0 ? "plus" : "minus"}`}>{log.amount >= 0 ? "+" : "-"}</span>
                      {log.amount > 0 ? `+${log.amount}` : log.amount}
                    </td>
                    <td>{log.balanceBefore}</td>
                    <td>{log.balanceAfter}</td>
                    <td>{log.remark || "暂无"}</td>
                    <td>{formatTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!creditLogsLoading && creditLogs.length === 0 ? <div className="empty-state">暂无积分流水</div> : null}
            {creditLogsLoading ? <div className="empty-state">积分流水加载中...</div> : null}
            <div className="pagination centered"><a>‹</a><a className="active">1</a><a>2</a><a>3</a><a>4</a><a>5</a><span>...</span><a>10</a><a>›</a></div>
          </Card>
        </div>
        <aside className="profile-side">
          <Card className="member-card">
            <div className="card-title-row"><h3>会员中心</h3><a>查看详情</a></div>
            <div className="member-progress"><strong>{user?.role === "admin" ? "管理员" : "普通用户"}</strong><span>当前等级</span><i /><p>升级还需 1000 积分 <b>1000 / 2000</b></p></div>
          </Card>
          <Card className="quick-card">
            <h3>快捷入口</h3>
            <div className="quick-grid">
              {quickLinks.map(([Icon, label]) => <button key={label}><Icon size={28} />{label}</button>)}
            </div>
          </Card>
          <Card className="help-card">
            <div><h3>需要帮助?</h3><p>如果你在使用过程中遇到问题，可以随时联系我们的客服团队。</p><button>联系客服</button></div>
            <Headphones size={86} />
          </Card>
        </aside>
      </section>
    </PageLayout>
  );
}
