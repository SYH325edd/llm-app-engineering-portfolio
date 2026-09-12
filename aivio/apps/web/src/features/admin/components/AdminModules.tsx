import { ChevronDown, ChevronRight, ClipboardList, Database, Grid2X2, PackageCheck, Plus, Users, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import Card from "../../../components/Card";
import DataTable from "../../../components/DataTable";
import StatCard from "../../../components/StatCard";
import StatusBadge from "../../../components/StatusBadge";
import type { SystemHealth } from "../health-api";
import type { AdminCreditLog, AdminLog, AdminModel, AdminModelCreate, AdminOrder, AdminPricingRule, AdminProvider, AdminProviderCreate, AdminStats, AdminTask, AdminUserDetail, AdminUser } from "../api";
import { adminActionLabel, adminTargetLabel, creditTypeLabel, enabledLabel, formatAdminTime, inputTypeLabel, modelTypeLabel, orderStatusLabel, outputTypeLabel, paymentProviderLabel, roleLabel, taskStatusLabel, userStatusLabel } from "../../../utils/labels";
import { badgeStatus, brief, calculateAdminSalesPriceFromCost, defaultOpenSections, detailSummary, formatAdminCny, healthBadgeLabel, healthBadgeStatus, modelTemplates, orderedPersonSections, personModuleDescription, personModuleTitle, pointsFromCost, userLabel } from "../admin-utils";
import type { ModelDraft, PeopleModuleKey, PersonSectionKey, PricingDraft, ProviderDraft, StatItem } from "../admin-utils";

function AdminTable({ title, loading, error, empty, action, children }: { title: string; loading?: boolean; error?: string; empty: boolean; action?: ReactNode; children: ReactNode }) {
  return <Card className="admin-live-card"><div className="card-title-row admin-live-head"><h3>{title}</h3>{action}</div>{error ? <p className="data-error">{error}</p> : null}{children}{loading ? <div className="empty-state">数据加载中...</div> : null}{!loading && empty ? <div className="empty-state">暂无数据</div> : null}</Card>;
}

export function Overview(props: {
  stats: AdminStats | null;
  statCards: StatItem[];
  loading?: boolean;
  error?: string;
  systemHealth: SystemHealth | null;
  systemHealthLoading?: boolean;
  systemHealthError?: string;
  refreshSystemHealth: () => void;
}) {
  const systemRows: Array<{ icon: LucideIcon; title: string; detail: string; status: boolean | "unknown" }> = props.systemHealth ? [
    {
      icon: PackageCheck,
      title: "API 服务",
      detail: props.systemHealth.checks.api ? "API 在线，可响应健康检查接口。" : "API 未就绪，相关能力可能不可用。",
      status: props.systemHealth.checks.api
    },
    {
      icon: Database,
      title: "数据库",
      detail:
        props.systemHealth.checks.database === true
          ? "数据库连接正常。"
          : props.systemHealth.checks.database === "unknown"
            ? "数据库状态未知，请检查后端配置。"
            : "数据库不可用，相关能力可能不可用。",
      status: props.systemHealth.checks.database
    },
    {
      icon: WalletCards,
      title: "测试支付",
      detail: props.systemHealth.checks.mockPaymentEnabled ? "测试支付已开启，仅应在测试环境使用。" : "测试支付已关闭，生产环境应保持关闭。",
      status: props.systemHealth.checks.mockPaymentEnabled
    },
    {
      icon: Grid2X2,
      title: "火山方舟",
      detail: props.systemHealth.checks.volcengineConfigured ? "已配置，相关能力可继续联调。" : "未配置，相关能力可能不可用。",
      status: props.systemHealth.checks.volcengineConfigured
    },
    {
      icon: ClipboardList,
      title: "Agnes",
      detail: props.systemHealth.checks.agnesConfigured ? "已配置，相关能力可继续联调。" : "未配置，相关能力可能不可用。",
      status: props.systemHealth.checks.agnesConfigured
    },
    {
      icon: Users,
      title: "素材公网地址",
      detail: props.systemHealth.checks.publicAssetBaseUrlConfigured ? "已配置，外部模型可按当前地址尝试访问素材。" : "未配置，本地上传素材可能无法被外部模型访问。",
      status: props.systemHealth.checks.publicAssetBaseUrlConfigured
    }
  ] : [];

  return (
    <>
      {props.error ? <p className="data-error compact">{props.error}</p> : null}
      <section className="admin-stat-grid admin-stat-grid-wide">
        {props.statCards.map(([Icon, title, value]) => <StatCard key={title} icon={<Icon />} label={title} value={String(value)} />)}
      </section>
      {props.loading ? <Card className="admin-panel-state">数据总览加载中...</Card> : null}
      {!props.loading && !props.stats ? <Card className="admin-panel-state">暂无数据</Card> : null}
      <Card className="system-card admin-system-status-card">
        <div className="card-title-row">
          <div>
            <h3>系统状态</h3>
            <p className="panel-subtitle">
              {props.systemHealth ? `环境：${props.systemHealth.environment} · 更新时间：${formatAdminTime(props.systemHealth.timestamp)}` : "用于本地自检与上线前诊断"}
            </p>
          </div>
          <button className="admin-action" type="button" onClick={props.refreshSystemHealth}>刷新状态</button>
        </div>
        {props.systemHealthError ? <p className="data-error compact">{props.systemHealthError}</p> : null}
        {props.systemHealthLoading ? <div className="admin-panel-state">系统状态加载中...</div> : null}
        {!props.systemHealthLoading && !props.systemHealthError && props.systemHealth ? (
          <div className="admin-system-grid">
            {systemRows.map((row) => {
              const Icon = row.icon;
              return (
                <div className="system-row" key={row.title}>
                  <Icon />
                  <div>
                    <strong>{row.title}</strong>
                    <span>{row.detail}</span>
                  </div>
                  <StatusBadge status={healthBadgeStatus(row.status)}>{healthBadgeLabel(row.status)}</StatusBadge>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </>
  );
}

function UsersModule(props: {
  users: AdminUser[]; total?: number; loading?: boolean; error?: string; savingId: string; adjustingUserId: string; adjustAmount: string; adjustRemark: string;
  setAdjustingUserId: (value: string) => void; setAdjustAmount: (value: string) => void; setAdjustRemark: (value: string) => void;
  saveAdjustment: (id: string) => void; saveUserStatus: (user: AdminUser) => void;
}) {
  return (
    <AdminTable title={`用户管理${props.total === undefined ? "" : ` · 共 ${props.total} 条`}`} loading={props.loading} error={props.error} empty={!props.users.length}>
      <DataTable rows={props.users} columns={[
        { key: "email", title: "邮箱", render: (row) => row.email },
        { key: "nickname", title: "昵称", render: (row) => row.nickname || "--" },
        { key: "role", title: "角色", render: (row) => roleLabel(row.role) },
        { key: "status", title: "账号状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{userStatusLabel(row.status)}</StatusBadge> },
        { key: "balance", title: "余额", align: "right", render: (row) => `${row.balance} 积分` },
        { key: "createdAt", title: "注册时间", render: (row) => formatAdminTime(row.createdAt) },
        { key: "lastLoginAt", title: "最近登录", render: (row) => formatAdminTime(row.lastLoginAt) },
        { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" onClick={() => props.setAdjustingUserId(row.id)}>调整余额</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.saveUserStatus(row)}>{row.status === "disabled" ? "启用" : "禁用"}</button></div> }
      ]} />
      {props.adjustingUserId ? <div className="admin-adjust-row"><strong>调整余额</strong><input type="number" step="1" placeholder="正数增加，负数扣减" value={props.adjustAmount} onChange={(event) => props.setAdjustAmount(event.target.value)} /><input placeholder="备注" value={props.adjustRemark} onChange={(event) => props.setAdjustRemark(event.target.value)} /><button className="admin-action" type="button" disabled={props.savingId === props.adjustingUserId} onClick={() => props.saveAdjustment(props.adjustingUserId)}>保存</button><button className="admin-action muted" type="button" onClick={() => props.setAdjustingUserId("")}>取消</button></div> : null}
    </AdminTable>
  );
}

function OrdersModule({ orders, total, loading, error }: { orders: AdminOrder[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`订单管理${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!orders.length}><DataTable rows={orders} columns={[
    { key: "orderNo", title: "订单号", render: (row) => row.orderNo },
    { key: "user", title: "用户", render: (row) => userLabel(row.userEmail, row.userNickname, row.userId) },
    { key: "amount", title: "支付金额", align: "right", render: (row) => `¥${row.amount}` },
    { key: "credits", title: "获得积分", align: "right", render: (row) => row.credits },
    { key: "paymentProvider", title: "支付方式", render: (row) => paymentProviderLabel(row.paymentProvider) },
    { key: "status", title: "订单状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{orderStatusLabel(row.status)}</StatusBadge> },
    { key: "paidAt", title: "支付时间", render: (row) => formatAdminTime(row.paidAt) },
    { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}

function TasksModule({ tasks, total, loading, error }: { tasks: AdminTask[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`任务管理${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!tasks.length}><DataTable rows={tasks} columns={[
    { key: "id", title: "任务 ID", render: (row) => <span title={row.id}>{brief(row.id, 14)}</span> },
    { key: "user", title: "用户", render: (row) => userLabel(row.userEmail, row.userNickname, row.userId) },
    { key: "modelDisplayName", title: "模型名称", render: (row) => row.modelDisplayName || "--" },
    { key: "modelId", title: "模型标识", render: (row) => <span title={row.modelId}>{brief(row.modelId, 18)}</span> },
    { key: "prompt", title: "提示词", render: (row) => <span className="admin-clamp" title={row.prompt}>{brief(row.prompt, 34)}</span> },
    { key: "status", title: "任务状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{taskStatusLabel(row.status)}</StatusBadge> },
    { key: "cost", title: "消耗积分", align: "right", render: (row) => `${row.cost} 积分` },
    { key: "providerTaskId", title: "上游任务 ID", render: (row) => <span title={row.providerTaskId}>{brief(row.providerTaskId, 16)}</span> },
    { key: "result", title: "结果 / 错误", render: (row) => row.resultUrl ? <a className="task-link" href={row.resultUrl} target="_blank" rel="noreferrer">查看结果</a> : <span className="admin-clamp" title={row.errorMessage}>{brief(row.errorMessage, 26)}</span> },
    { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}

function CreditsModule({ logs, total, loading, error }: { logs: AdminCreditLog[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`积分流水${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!logs.length}><DataTable rows={logs} columns={[
    { key: "user", title: "用户", render: (row) => userLabel(row.userEmail, row.userNickname, row.userId) },
    { key: "type", title: "流水类型", render: (row) => creditTypeLabel(row.type) },
    { key: "amount", title: "积分变动", align: "right", render: (row) => row.amount },
    { key: "balanceBefore", title: "变动前余额", align: "right", render: (row) => row.balanceBefore },
    { key: "balanceAfter", title: "变动后余额", align: "right", render: (row) => row.balanceAfter },
    { key: "relatedTaskId", title: "关联任务", render: (row) => <span title={row.relatedTaskId || ""}>{brief(row.relatedTaskId, 14)}</span> },
    { key: "relatedOrderId", title: "关联订单", render: (row) => <span title={row.relatedOrderId || ""}>{brief(row.relatedOrderId, 14)}</span> },
    { key: "remark", title: "备注", render: (row) => <span className="admin-clamp" title={row.remark}>{brief(row.remark, 26)}</span> },
    { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}

export function PeopleDataModule(props: {
  view: PeopleModuleKey;
  users: AdminUser[];
  total?: number;
  loading?: boolean;
  error?: string;
  savingId: string;
  adjustingUserId: string;
  adjustAmount: string;
  adjustRemark: string;
  setAdjustingUserId: (value: string) => void;
  setAdjustAmount: (value: string) => void;
  setAdjustRemark: (value: string) => void;
  saveAdjustment: (id: string) => void;
  saveUserStatus: (user: AdminUser) => void;
}) {
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);
  const [detailMap, setDetailMap] = useState<Record<string, AdminUserDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, Record<PersonSectionKey, boolean>>>({});
  const [inviteSourceOpen, setInviteSourceOpen] = useState<Record<string, boolean>>({});

  function sectionTitle(section: PersonSectionKey) {
    if (section === "orders") return "订单";
    if (section === "tasks") return "任务";
    return "积分";
  }

  async function ensureUserDetail(userId: string) {
    if (detailMap[userId] || detailLoading[userId]) return;
    setDetailLoading((current) => ({ ...current, [userId]: true }));
    setDetailErrors((current) => ({ ...current, [userId]: "" }));
    try {
      const detail = await getAdminUserDetail(userId);
      setDetailMap((current) => ({ ...current, [userId]: detail }));
      setOpenSections((current) => ({
        ...current,
        [userId]: current[userId] || defaultOpenSections(props.view)
      }));
    } catch (error) {
      setDetailErrors((current) => ({ ...current, [userId]: adminError(error) }));
    } finally {
      setDetailLoading((current) => ({ ...current, [userId]: false }));
    }
  }

  function toggleUser(userId: string) {
    const expanded = expandedUserIds.includes(userId);
    if (expanded) {
      setExpandedUserIds((current) => current.filter((id) => id !== userId));
      return;
    }
    setExpandedUserIds((current) => [...current, userId]);
    void ensureUserDetail(userId);
  }

  function toggleSection(userId: string, section: PersonSectionKey) {
    const defaults = openSections[userId] || defaultOpenSections(props.view);
    setOpenSections((current) => ({
      ...current,
      [userId]: {
        ...defaults,
        [section]: !defaults[section]
      }
    }));
  }

  function renderOrders(rows: AdminOrder[]) {
    if (!rows.length) return <div className="empty-state">暂无订单</div>;
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: "orderNo", title: "订单号", render: (row) => row.orderNo },
          { key: "amount", title: "支付金额", align: "right", render: (row) => `￥${row.amount}` },
          { key: "credits", title: "获得积分", align: "right", render: (row) => row.credits },
          { key: "paymentProvider", title: "支付方式", render: (row) => paymentProviderLabel(row.paymentProvider) },
          { key: "status", title: "订单状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{orderStatusLabel(row.status)}</StatusBadge> },
          { key: "paidAt", title: "支付时间", render: (row) => formatAdminTime(row.paidAt) },
          { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
        ]}
      />
    );
  }

  function renderTasks(rows: AdminTask[]) {
    if (!rows.length) return <div className="empty-state">暂无任务</div>;
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: "id", title: "任务 ID", render: (row) => <span title={row.id}>{brief(row.id, 14)}</span> },
          { key: "modelDisplayName", title: "模型名称", render: (row) => row.modelDisplayName || "--" },
          { key: "prompt", title: "提示词", render: (row) => <span className="admin-clamp" title={row.prompt}>{brief(row.prompt, 34)}</span> },
          { key: "status", title: "任务状态", render: (row) => <StatusBadge status={badgeStatus(row.status)}>{taskStatusLabel(row.status)}</StatusBadge> },
          { key: "cost", title: "消耗积分", align: "right", render: (row) => `${row.cost} 积分` },
          {
            key: "result",
            title: "结果 / 错误",
            render: (row) => row.resultUrl
              ? <a className="task-link" href={row.resultUrl} target="_blank" rel="noreferrer">查看结果</a>
              : <span className="admin-clamp" title={row.errorMessage || row.providerTaskId}>{brief(row.errorMessage || row.providerTaskId, 26)}</span>
          },
          { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
        ]}
      />
    );
  }

  function renderCredits(rows: AdminCreditLog[]) {
    if (!rows.length) return <div className="empty-state">暂无积分流水</div>;
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: "type", title: "流水类型", render: (row) => creditTypeLabel(row.type) },
          { key: "amount", title: "积分变动", align: "right", render: (row) => row.amount },
          { key: "balanceBefore", title: "变动前余额", align: "right", render: (row) => row.balanceBefore },
          { key: "balanceAfter", title: "变动后余额", align: "right", render: (row) => row.balanceAfter },
          { key: "remark", title: "备注", render: (row) => <span className="admin-clamp" title={row.remark}>{brief(row.remark, 26)}</span> },
          { key: "createdAt", title: "创建时间", render: (row) => formatAdminTime(row.createdAt) }
        ]}
      />
    );
  }

  return (
    <AdminTable
      title={`${personModuleTitle(props.view)}${props.total === undefined ? "" : ` · 共 ${props.total} 位用户`}`}
      loading={props.loading}
      error={props.error}
      empty={!props.users.length}
    >
      <div className="people-module-copy">
        <span>{personModuleDescription(props.view)}</span>
      </div>
      <div className="people-user-list">
        {props.users.map((user) => {
          const expanded = expandedUserIds.includes(user.id);
          const detail = detailMap[user.id];
          const sections = openSections[user.id] || defaultOpenSections(props.view);
          const summaryTasks = detail?.tasks.length;
          const summaryOrders = detail?.orders.length;
          const summaryCredits = detail?.creditLogs.length;

          return (
            <section className={`people-user-card${expanded ? " expanded" : ""}`} key={user.id}>
              <div className="people-user-head">
                <button className="people-user-trigger" type="button" onClick={() => toggleUser(user.id)}>
                  <span className="people-user-chevron">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                  <div className="people-user-identity">
                    <strong>{userLabel(user.email, user.nickname, user.id)}</strong>
                    <span>{user.email || user.nickname || user.id}</span>
                    <div className="people-user-kpis">
                      <span><b>余额</b>{user.balance} 积分</span>
                      <span><b>任务</b>{summaryTasks ?? "--"}</span>
                      <span><b>订单</b>{summaryOrders ?? "--"}</span>
                      <span><b>积分</b>{summaryCredits ?? "--"}</span>
                    </div>
                  </div>
                </button>
                <div className="people-user-actions">
                  <StatusBadge status={badgeStatus(user.status)}>{userStatusLabel(user.status)}</StatusBadge>
                  <button className="admin-action" type="button" onClick={() => props.setAdjustingUserId(user.id)}>调整余额</button>
                  <button className="admin-action" type="button" disabled={props.savingId === user.id} onClick={() => props.saveUserStatus(user)}>
                    {user.status === "disabled" ? "启用" : "禁用"}
                  </button>
                </div>
              </div>

              {props.adjustingUserId === user.id ? (
                <div className="admin-adjust-row people-adjust-row">
                  <strong>调整余额</strong>
                  <input type="number" step="1" placeholder="正数增加，负数扣减" value={props.adjustAmount} onChange={(event) => props.setAdjustAmount(event.target.value)} />
                  <input placeholder="备注" value={props.adjustRemark} onChange={(event) => props.setAdjustRemark(event.target.value)} />
                  <button className="admin-action" type="button" disabled={props.savingId === props.adjustingUserId} onClick={() => props.saveAdjustment(props.adjustingUserId)}>保存</button>
                  <button className="admin-action muted" type="button" onClick={() => props.setAdjustingUserId("")}>取消</button>
                </div>
              ) : null}

              {expanded ? (
                <div className="people-user-detail">
                  <div className="people-user-meta">
                    {detail?.inviteSource?.code ? <button className="people-invite-source" type="button" onClick={() => setInviteSourceOpen((current) => ({ ...current, [user.id]: !current[user.id] }))}>邀请码来源：{detail.inviteSource.code}</button> : <span>邀请码来源：否</span>}
                    <span>角色：{roleLabel(user.role)}</span>
                    <span>注册时间：{formatAdminTime(user.createdAt)}</span>
                    <span>最近登录：{formatAdminTime(user.lastLoginAt)}</span>
                  </div>
                  {detail?.inviteSource?.code && inviteSourceOpen[user.id] ? <div className="people-invite-detail"><span>邀请人邮箱：{detail.inviteSource.inviter?.email || "--"}</span><span>邀请人 ID：{detail.inviteSource.inviter?.id || "--"}</span><span>邀请人身份：{detail.inviteSource.inviter?.role === "admin" ? "管理员" : "普通用户"}</span></div> : null}
                  {detailErrors[user.id] ? <p className="data-error compact">{detailErrors[user.id]}</p> : null}
                  {detailLoading[user.id] ? <div className="empty-state">用户数据加载中...</div> : null}
                  {!detailLoading[user.id] && detail ? (
                    <div className="people-sections">
                      {orderedPersonSections(props.view).map((section) => {
                        const open = sections[section];
                        const count = section === "orders" ? detail.orders.length : section === "tasks" ? detail.tasks.length : detail.creditLogs.length;
                        return (
                          <div className={`people-section${open ? " open" : ""}`} key={`${user.id}-${section}`}>
                            <button className="people-section-toggle" type="button" onClick={() => toggleSection(user.id, section)}>
                              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              <strong>{sectionTitle(section)}</strong>
                              <small>{count} 条</small>
                            </button>
                            {open ? (
                              <div className="people-section-body">
                                {section === "orders" ? renderOrders(detail.orders) : null}
                                {section === "tasks" ? renderTasks(detail.tasks) : null}
                                {section === "credits" ? renderCredits(detail.creditLogs) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </AdminTable>
  );
}

export function ModelsModule(props: {
  models: AdminModel[]; providers: AdminProvider[]; drafts: Record<string, ModelDraft>; draft: AdminModelCreate; creating: boolean; loading?: boolean; error?: string; savingId: string;
  pricingRules: AdminPricingRule[]; pricingDrafts: Record<string, PricingDraft>; selectedPricingModelId: string; creatingPricingRule: boolean; newPricingRule: PricingDraft; pricingLoading?: boolean; pricingError?: string;
  setDrafts: Dispatch<SetStateAction<Record<string, ModelDraft>>>; setDraft: Dispatch<SetStateAction<AdminModelCreate>>; setCreating: (value: boolean) => void;
  setSelectedPricingModelId: (value: string) => void; setPricingDrafts: Dispatch<SetStateAction<Record<string, PricingDraft>>>; setCreatingPricingRule: (value: boolean) => void; setNewPricingRule: Dispatch<SetStateAction<PricingDraft>>;
  saveModel: (id: string) => void; submitModel: (event: FormEvent) => void; toggleModel: (model: AdminModel) => void; removeModel: (model: AdminModel) => void;
  savePricingRule: (id: string) => void; submitPricingRule: (event: FormEvent) => void; togglePricingRule: (rule: AdminPricingRule) => void; removePricingRule: (rule: AdminPricingRule) => void;
}) {
  const selectedModel = props.models.find((model) => model.id === props.selectedPricingModelId);
  return (
    <>
      <AdminTable title="模型管理" loading={props.loading} error={props.error} empty={!props.models.length} action={<button className="admin-action primary" type="button" onClick={() => props.setCreating(!props.creating)}><Plus size={15} /> 新增模型</button>}>
        {props.creating ? <ModelCreateForm providers={props.providers} draft={props.draft} saving={props.savingId === "new-model"} setDraft={props.setDraft} submit={props.submitModel} cancel={() => props.setCreating(false)} /> : null}
        {props.selectedPricingModelId ? (
          <div className="admin-editor">
            <div className="admin-editor-head">
              <strong>{`计费规则${selectedModel ? ` · ${selectedModel.displayName}` : ""}`}</strong>
            </div>
            <div className="admin-form-actions">
              <button className="admin-action primary" type="button" onClick={() => props.setCreatingPricingRule(!props.creatingPricingRule)}><Plus size={15} /> 新增计费规则</button>
            </div>
            {props.creatingPricingRule ? <PricingRuleForm draft={props.newPricingRule} saving={props.savingId === "new-pricing-rule"} setDraft={props.setNewPricingRule} submit={props.submitPricingRule} cancel={() => props.setCreatingPricingRule(false)} /> : null}
            {props.pricingError ? <p className="data-error compact">{props.pricingError}</p> : null}
            {props.pricingLoading ? <p className="hint">计费规则加载中...</p> : null}
            {!props.pricingLoading && !props.pricingRules.length ? <p className="admin-warning">请先添加计费规则。</p> : null}
            {props.pricingRules.length ? <PricingRulesTable rules={props.pricingRules} drafts={props.pricingDrafts} savingId={props.savingId} setDrafts={props.setPricingDrafts} save={props.savePricingRule} toggle={props.togglePricingRule} remove={props.removePricingRule} /> : null}
          </div>
        ) : null}
        <DataTable rows={props.models} columns={[
          { key: "displayName", title: "模型名称", render: (row) => <input className="admin-cell-input" value={props.drafts[row.id]?.displayName || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], displayName: event.target.value } }))} /> },
          { key: "modelKey", title: "模型标识", render: (row) => <span title={row.modelKey}>{brief(row.modelKey, 22)}</span> },
          { key: "provider", title: "供应商", render: (row) => <span title={row.providerKey}>{row.providerDisplayName || row.providerKey || "--"}</span> },
          { key: "modelType", title: "模型类型", render: (row) => modelTypeLabel(row.modelType) },
          { key: "inputType", title: "输入类型", render: (row) => inputTypeLabel(row.inputType) },
          { key: "outputType", title: "输出类型", render: (row) => outputTypeLabel(row.outputType) },
          { key: "price", title: "旧单次价格", align: "right", render: (row) => <div><input className="admin-number-input" type="number" min="0" step="1" value={props.drafts[row.id]?.price ?? 0} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], price: Number(event.target.value) } }))} />{row.modelType === "video" ? <small className="admin-warning">视频扣费看上方计费规则</small> : null}</div> },
          { key: "enabled", title: "\u542f\u7528\u72b6\u6001", render: (row) => <div><StatusBadge status={badgeStatus(row.enabled)}>{enabledLabel(row.enabled)}</StatusBadge>{row.enabled && row.modelType === "video" && !row.hasEnabledPricingRules ? <small className="admin-warning">{"\u8bf7\u5148\u6dfb\u52a0\u8ba1\u8d39\u89c4\u5219\u3002"}</small> : null}</div> },
          { key: "sortOrder", title: "排序", align: "right", render: (row) => <input className="admin-number-input" type="number" step="1" value={props.drafts[row.id]?.sortOrder ?? 0} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], sortOrder: Number(event.target.value) } }))} /> },
          { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.saveModel(row.id)}>保存</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.toggleModel(row)}>{row.enabled ? "禁用" : "启用"}</button><button className="admin-action" type="button" onClick={() => props.setSelectedPricingModelId(row.id)}>{props.selectedPricingModelId === row.id ? "正在编辑计费" : "编辑计费规则"}</button><button className="admin-action danger" type="button" disabled={props.savingId === row.id} onClick={() => props.removeModel(row)}>删除</button></div> }
        ]} />
      </AdminTable>
    </>
  );
}

function ModelCreateForm({ providers, draft, saving, setDraft, submit, cancel }: { providers: AdminProvider[]; draft: AdminModelCreate; saving: boolean; setDraft: Dispatch<SetStateAction<AdminModelCreate>>; submit: (event: FormEvent) => void; cancel: () => void }) {
  const [templateKey, setTemplateKey] = useState<ModelTemplateKey | "">("");
  const defaultRuleCount = draft.defaultPricingRules?.length || 0;
  const labels = {
    title: "\u65b0\u589e\u6a21\u578b",
    intro: "\u9009\u62e9\u6a21\u677f\u540e\uff0c\u7ba1\u7406\u5458\u53ea\u9700\u8981\u586b\u5199\u6a21\u578b\u540d\u79f0\u548c ep- \u63a5\u5165\u70b9 ID\u3002",
    template: "\u5feb\u901f\u9009\u62e9\u6a21\u677f",
    chooseTemplate: "\u8bf7\u9009\u62e9\u6a21\u677f",
    modelName: "\u6a21\u578b\u540d\u79f0",
    modelNameHelp: "\u663e\u793a\u7ed9\u7528\u6237\u770b\u7684\u540d\u5b57\uff0c\u4f8b\u5982 Doubao Seedance 1.0 Pro Fast",
    modelKey: "\u6a21\u578b\u6807\u8bc6 / \u63a5\u5165\u70b9 ID",
    modelKeyHelp: "\u586b\u5199\u706b\u5c71\u65b9\u821f\u63a7\u5236\u53f0\u91cc\u7684 ep- \u5f00\u5934\u63a5\u5165\u70b9 ID\uff0c\u4f8b\u5982 ep-20260527143333-wf4ml",
    provider: "\u4f9b\u5e94\u5546",
    chooseProvider: "\u8bf7\u9009\u62e9\u4f9b\u5e94\u5546",
    modelType: "\u6a21\u578b\u7c7b\u578b",
    videoModel: "\u89c6\u9891\u6a21\u578b",
    imageModel: "\u56fe\u50cf\u6a21\u578b",
    chatModel: "\u5bf9\u8bdd\u6a21\u578b",
    audioModel: "\u97f3\u9891\u6a21\u578b",
    inputType: "\u8f93\u5165\u7c7b\u578b",
    inputTypeHelp: "\u89c6\u9891\u6a21\u578b\u4e00\u822c\u586b\u5199 text,image",
    outputType: "\u8f93\u51fa\u7c7b\u578b",
    outputTypeHelp: "\u89c6\u9891\u6a21\u578b\u586b\u5199 video",
    oldPrice: "\u65e7\u5355\u6b21\u4ef7\u683c",
    sortOrder: "\u6392\u5e8f\u5efa\u8bae\u503c",
    enabled: "\u542f\u7528\u72b6\u6001",
    configJson: "\u914d\u7f6e JSON",
    configHelp: "\u9ad8\u7ea7\u914d\u7f6e\uff0c\u53ef\u4e0d\u586b\uff0c\u9ed8\u8ba4 {}\u3002\u4e0d\u8981\u5728\u8fd9\u91cc\u586b\u5199 API Key\uff0c\u4e5f\u4e0d\u8981\u586b\u5199 ep- \u63a5\u5165\u70b9 ID\u3002",
    defaultRules: "\u9ed8\u8ba4\u8ba1\u8d39\u89c4\u5219\uff1a",
    save: "\u4fdd\u5b58",
    cancel: "\u53d6\u6d88"
  };
  const ruleSummary = defaultRuleCount ? `${defaultRuleCount} \u6761\uff0c\u5c06\u968f\u6a21\u578b\u4e00\u8d77\u521b\u5efa` : "\u672a\u9009\u62e9\u6a21\u677f\uff1b\u542f\u7528\u89c6\u9891\u6a21\u578b\u524d\u8bf7\u5148\u6dfb\u52a0\u8ba1\u8d39\u89c4\u5219\u3002";

  function applyTemplate(value: string) {
    setTemplateKey(value as ModelTemplateKey | "");
    const template = modelTemplates.find((item) => item.key === value);
    if (!template) return;
    const volcengineProvider = providers.find((provider) => provider.providerKey === "volcengine");
    setDraft((current) => ({
      ...current,
      providerId: volcengineProvider?.id || current.providerId,
      modelType: "video",
      inputType: "text,image",
      outputType: "video",
      configJson: "{}",
      sortOrder: template.sortOrder,
      defaultPricingRules: template.rules
    }));
  }

  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor-head"><strong>{labels.title}</strong><span>{labels.intro}</span></div>
      <div className="admin-form-grid">
        <label>{labels.template}<select value={templateKey} onChange={(event) => applyTemplate(event.target.value)}><option value="">{labels.chooseTemplate}</option>{modelTemplates.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}</select></label>
        <label>{labels.modelName}<input required placeholder={labels.modelNameHelp} value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label>{labels.modelKey}<input required placeholder={labels.modelKeyHelp} value={draft.modelKey} onChange={(event) => setDraft((current) => ({ ...current, modelKey: event.target.value }))} /></label>
        <label>{labels.provider}<select required value={draft.providerId || ""} onChange={(event) => setDraft((current) => ({ ...current, providerId: event.target.value }))}><option value="">{labels.chooseProvider}</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName} ({provider.providerKey})</option>)}</select></label>
        <label>{labels.modelType}<select value={draft.modelType} onChange={(event) => setDraft((current) => ({ ...current, modelType: event.target.value }))}><option value="video">{labels.videoModel}</option><option value="image">{labels.imageModel}</option><option value="chat">{labels.chatModel}</option><option value="audio">{labels.audioModel}</option></select></label>
        <label>{labels.inputType}<input required placeholder={labels.inputTypeHelp} value={draft.inputType} onChange={(event) => setDraft((current) => ({ ...current, inputType: event.target.value }))} /></label>
        <label>{labels.outputType}<input required placeholder={labels.outputTypeHelp} value={draft.outputType} onChange={(event) => setDraft((current) => ({ ...current, outputType: event.target.value }))} /></label>
        <label>{labels.oldPrice}<input type="number" min="0" step="1" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: Number(event.target.value) }))} /></label>
        <label>{labels.sortOrder}<input type="number" step="1" value={draft.sortOrder} onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
        <label className="admin-form-check">{labels.enabled}<input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>{enabledLabel(draft.enabled)}</span></label>
        <label className="admin-form-wide">{labels.configJson}<textarea placeholder={labels.configHelp} value={draft.configJson || "{}"} onChange={(event) => setDraft((current) => ({ ...current, configJson: event.target.value }))} /></label>
        <div className="admin-form-wide admin-help">{labels.defaultRules}{ruleSummary}</div>
      </div>
      <div className="admin-form-actions"><button className="admin-action primary" type="submit" disabled={saving}>{labels.save}</button><button className="admin-action muted" type="button" onClick={cancel}>{labels.cancel}</button></div>
    </form>
  );
}


function PricingRulesTable(props: {
  rules: AdminPricingRule[]; drafts: Record<string, PricingDraft>; savingId: string;
  setDrafts: Dispatch<SetStateAction<Record<string, PricingDraft>>>;
  save: (id: string) => void; toggle: (rule: AdminPricingRule) => void; remove: (rule: AdminPricingRule) => void;
}) {
  function patch(id: string, value: Partial<PricingDraft>) {
    props.setDrafts((current) => ({ ...current, [id]: { ...current[id], ...value } }));
  }
  return <DataTable rows={props.rules} columns={[
    { key: "inputContainsVideo", title: "输入模式", render: (row) => <select value={String(props.drafts[row.id]?.inputContainsVideo ?? row.inputContainsVideo)} onChange={(event) => patch(row.id, { inputContainsVideo: event.target.value === "true" })}><option value="false">输入不含视频</option><option value="true">输入包含视频</option></select> },
    { key: "audioMode", title: "声音模式", render: (row) => <select value={props.drafts[row.id]?.audioMode || "default"} onChange={(event) => patch(row.id, { audioMode: event.target.value })}><option value="default">默认</option><option value="audio">有声视频</option><option value="silent">无声视频</option></select> },
    { key: "resolution", title: "分辨率", render: (row) => <select value={props.drafts[row.id]?.resolution || row.resolution} onChange={(event) => patch(row.id, { resolution: event.target.value })}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select> },
    { key: "output", title: "输出时长", render: (row) => <div className="admin-inline-actions"><input className="admin-number-input" type="number" min="4" max="15" value={props.drafts[row.id]?.minOutputDuration ?? row.minOutputDuration} onChange={(event) => patch(row.id, { minOutputDuration: Number(event.target.value) })} /><input className="admin-number-input" type="number" min="4" max="15" value={props.drafts[row.id]?.maxOutputDuration ?? row.maxOutputDuration} onChange={(event) => patch(row.id, { maxOutputDuration: Number(event.target.value) })} /></div> },
    { key: "input", title: "输入视频时长", render: (row) => <div className="admin-inline-actions"><input className="admin-number-input" type="number" min="2" max="15" value={props.drafts[row.id]?.minInputVideoDuration ?? ""} onChange={(event) => patch(row.id, { minInputVideoDuration: event.target.value ? Number(event.target.value) : null })} /><input className="admin-number-input" type="number" min="2" max="15" value={props.drafts[row.id]?.maxInputVideoDuration ?? ""} onChange={(event) => patch(row.id, { maxInputVideoDuration: event.target.value ? Number(event.target.value) : null })} /></div> },
    { key: "billable", title: "最低计费输入", align: "right", render: (row) => <input className="admin-number-input" type="number" min="2" max="15" value={props.drafts[row.id]?.minBillableInputVideoDuration ?? ""} onChange={(event) => patch(row.id, { minBillableInputVideoDuration: event.target.value ? Number(event.target.value) : null })} /> },
    { key: "costPerSecondRmb", title: "成本元/秒", align: "right", render: (row) => <input className="admin-number-input" type="number" min="0" step="0.0001" value={props.drafts[row.id]?.costPerSecondRmb ?? ""} onChange={(event) => {
      const cost = event.target.value ? Number(event.target.value) : null;
      patch(row.id, { costPerSecondRmb: cost, pointsPerSecond: pointsFromCost(cost) });
    }} /> },
    { key: "salesCnyPerSecond", title: "销售价格元/秒", align: "right", render: (row) => {
      const sales = calculateAdminSalesPriceFromCost(props.drafts[row.id]?.costPerSecondRmb ?? row.costPerSecondRmb);
      return <input className="admin-number-input" type="number" min="0" step="0.01" value={formatAdminCny(sales.salesCnyPerSecond)} readOnly />;
    } },
    { key: "enabled", title: "启用状态", render: (row) => <StatusBadge status={badgeStatus(row.enabled)}>{enabledLabel(row.enabled)}</StatusBadge> },
    { key: "remark", title: "备注", render: (row) => <input className="admin-cell-input" value={props.drafts[row.id]?.remark || ""} onChange={(event) => patch(row.id, { remark: event.target.value })} /> },
    { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.save(row.id)}>保存</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.toggle(row)}>{row.enabled ? "禁用" : "启用"}</button><button className="admin-action danger" type="button" disabled={props.savingId === row.id} onClick={() => props.remove(row)}>删除</button></div> }
  ]} />;
}

function PricingRuleForm({ draft, saving, setDraft, submit, cancel }: { draft: PricingDraft; saving: boolean; setDraft: Dispatch<SetStateAction<PricingDraft>>; submit: (event: FormEvent) => void; cancel: () => void }) {
  const sales = calculateAdminSalesPriceFromCost(draft.costPerSecondRmb);
  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor-head"><strong>新增计费规则</strong><span>填写成本后，销售价格自动按 成本 × 1.2 计算；实际扣费时按 1 元 = 100 积分换算。</span></div>
      <div className="admin-form-grid">
        <label>输入模式<select value={String(draft.inputContainsVideo)} onChange={(event) => setDraft((current) => ({ ...current, inputContainsVideo: event.target.value === "true" }))}><option value="false">输入不含视频</option><option value="true">输入包含视频</option></select></label>
        <label>声音模式<select value={draft.audioMode} onChange={(event) => setDraft((current) => ({ ...current, audioMode: event.target.value }))}><option value="default">默认</option><option value="audio">有声视频</option><option value="silent">无声视频</option></select></label>
        <label>分辨率<select value={draft.resolution} onChange={(event) => setDraft((current) => ({ ...current, resolution: event.target.value }))}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
        <label>最短输出<input type="number" min="4" max="15" value={draft.minOutputDuration} onChange={(event) => setDraft((current) => ({ ...current, minOutputDuration: Number(event.target.value) }))} /></label>
        <label>最长输出<input type="number" min="4" max="15" value={draft.maxOutputDuration} onChange={(event) => setDraft((current) => ({ ...current, maxOutputDuration: Number(event.target.value) }))} /></label>
        <label>最短输入视频<input type="number" min="2" max="15" value={draft.minInputVideoDuration ?? ""} onChange={(event) => setDraft((current) => ({ ...current, minInputVideoDuration: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>最长输入视频<input type="number" min="2" max="15" value={draft.maxInputVideoDuration ?? ""} onChange={(event) => setDraft((current) => ({ ...current, maxInputVideoDuration: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>最低计费输入<input type="number" min="2" max="15" value={draft.minBillableInputVideoDuration ?? ""} onChange={(event) => setDraft((current) => ({ ...current, minBillableInputVideoDuration: event.target.value ? Number(event.target.value) : null }))} /></label>
        <label>成本元/秒<input type="number" min="0" step="0.0001" value={draft.costPerSecondRmb ?? ""} onChange={(event) => setDraft((current) => {
          const cost = event.target.value ? Number(event.target.value) : null;
          return { ...current, costPerSecondRmb: cost, pointsPerSecond: pointsFromCost(cost) };
        })} /></label>
        <label>销售价格元/秒<input type="number" min="0" step="0.01" value={formatAdminCny(sales.salesCnyPerSecond)} readOnly /></label>
        <label className="admin-form-check">启用状态<input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>{enabledLabel(draft.enabled)}</span></label>
        <label className="admin-form-wide">备注<input value={draft.remark} onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))} /></label>
      </div>
      <div className="admin-form-actions"><button className="admin-action primary" type="submit" disabled={saving}>保存</button><button className="admin-action muted" type="button" onClick={cancel}>取消</button></div>
    </form>
  );
}

export function ProvidersModule(props: {
  providers: AdminProvider[]; drafts: Record<string, ProviderDraft>; draft: AdminProviderCreate; creating: boolean; loading?: boolean; error?: string; savingId: string;
  setDrafts: Dispatch<SetStateAction<Record<string, ProviderDraft>>>; setDraft: Dispatch<SetStateAction<AdminProviderCreate>>; setCreating: (value: boolean) => void;
  saveProvider: (id: string) => void; submitProvider: (event: FormEvent) => void; toggleProvider: (provider: AdminProvider) => void; removeProvider: (provider: AdminProvider) => void;
}) {
  return (
    <AdminTable title="供应商管理" loading={props.loading} error={props.error} empty={!props.providers.length} action={<button className="admin-action primary" type="button" onClick={() => props.setCreating(!props.creating)}><Plus size={15} /> 新增供应商</button>}>
      {props.creating ? <ProviderCreateForm draft={props.draft} saving={props.savingId === "new-provider"} setDraft={props.setDraft} submit={props.submitProvider} cancel={() => props.setCreating(false)} /> : null}
      <DataTable rows={props.providers} columns={[
        { key: "displayName", title: "供应商名称", render: (row) => <input className="admin-cell-input" value={props.drafts[row.id]?.displayName || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], displayName: event.target.value } }))} /> },
        { key: "providerKey", title: "供应商标识", render: (row) => row.providerKey },
        { key: "enabled", title: "启用状态", render: (row) => <StatusBadge status={badgeStatus(row.enabled)}>{enabledLabel(row.enabled)}</StatusBadge> },
        { key: "baseUrl", title: "接口地址", render: (row) => <input className="admin-url-input" value={props.drafts[row.id]?.baseUrl || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], baseUrl: event.target.value } }))} /> },
        { key: "apiKeyEnvName", title: "密钥环境变量名", render: (row) => <div className="admin-env-cell"><input className="admin-cell-input" placeholder="ENV_NAME" value={props.drafts[row.id]?.apiKeyEnvName || ""} onChange={(event) => props.setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], apiKeyEnvName: event.target.value } }))} /><small>这里只填写环境变量名，不填写真实 API Key。</small></div> },
        { key: "updatedAt", title: "更新时间", render: (row) => formatAdminTime(row.updatedAt) },
        { key: "actions", title: "操作", render: (row) => <div className="admin-inline-actions"><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.saveProvider(row.id)}>保存</button><button className="admin-action" type="button" disabled={props.savingId === row.id} onClick={() => props.toggleProvider(row)}>{row.enabled ? "禁用" : "启用"}</button><button className="admin-action danger" type="button" disabled={props.savingId === row.id} onClick={() => props.removeProvider(row)}>删除</button></div> }
      ]} />
    </AdminTable>
  );
}

function ProviderCreateForm({ draft, saving, setDraft, submit, cancel }: { draft: AdminProviderCreate; saving: boolean; setDraft: Dispatch<SetStateAction<AdminProviderCreate>>; submit: (event: FormEvent) => void; cancel: () => void }) {
  return (
    <form className="admin-editor" onSubmit={submit}>
      <div className="admin-editor-head"><strong>新增供应商</strong><span>真实 API Key 只放在后端环境变量中。</span></div>
      <div className="admin-form-grid">
        <label>供应商名称<input required value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label>供应商标识<input required value={draft.providerKey} onChange={(event) => setDraft((current) => ({ ...current, providerKey: event.target.value }))} /></label>
        <label className="admin-form-wide">接口地址<input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
        <label>密钥环境变量名<input placeholder="PROVIDER_API_KEY" value={draft.apiKeyEnvName} onChange={(event) => setDraft((current) => ({ ...current, apiKeyEnvName: event.target.value }))} /><small>这里只填写环境变量名，不填写真实 API Key。</small></label>
        <label className="admin-form-check">启用状态<input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>{enabledLabel(draft.enabled)}</span></label>
        <label className="admin-form-wide">配置 JSON<textarea placeholder='{"adapter": "provider"}' value={draft.configJson || ""} onChange={(event) => setDraft((current) => ({ ...current, configJson: event.target.value }))} /></label>
      </div>
      <div className="admin-form-actions"><button className="admin-action primary" type="submit" disabled={saving}>保存</button><button className="admin-action muted" type="button" onClick={cancel}>取消</button></div>
    </form>
  );
}

export function LogsModule({ logs, total, loading, error }: { logs: AdminLog[]; total?: number; loading?: boolean; error?: string }) {
  return <AdminTable title={`操作日志${total === undefined ? "" : ` · 共 ${total} 条`}`} loading={loading} error={error} empty={!logs.length}><DataTable rows={logs} columns={[
    { key: "admin", title: "操作管理员", render: (row) => <span title={row.adminUserId}>{brief(row.adminUserId, 18)}</span> },
    { key: "action", title: "操作类型", render: (row) => adminActionLabel(row.action) },
    { key: "targetType", title: "操作对象", render: (row) => adminTargetLabel(row.targetType) },
    { key: "targetId", title: "对象 ID", render: (row) => <span title={row.targetId}>{brief(row.targetId, 16)}</span> },
    { key: "detail", title: "操作详情", render: (row) => <span className="admin-clamp" title={detailSummary(row.detail)}>{detailSummary(row.detail)}</span> },
    { key: "createdAt", title: "操作时间", render: (row) => formatAdminTime(row.createdAt) }
  ]} /></AdminTable>;
}
