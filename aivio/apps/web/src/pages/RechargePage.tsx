import { Building2, Check, Headphones, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import PageLayout from "../components/PageLayout";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { createOrder, getOrders, getRechargePackages, mockPayOrder } from "../lib/order";
import type { Order, RechargePackage } from "../lib/order";

function formatTime(value?: string | null) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待支付",
    paid: "已支付",
    failed: "失败",
    cancelled: "已取消",
    refunded: "已退款"
  };
  return labels[status] || status;
}

function statusType(status: string): "success" | "processing" | "waiting" | "failed" {
  if (status === "paid") return "success";
  if (status === "failed") return "failed";
  if (status === "refunded") return "processing";
  return "waiting";
}

function paymentProviderLabel(provider: string) {
  if (provider === "mock") return "测试支付";
  return provider || "--";
}

function friendlyError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "登录状态已失效，请重新登录。";
  if (error instanceof ApiError && error.status === 403) return error.message || "当前账号不可进行充值操作。";
  if (error instanceof TypeError) return "服务连接失败，请确认 Node API 已启动。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export default function RechargePage() {
  const navigate = useNavigate();
  const { balance, refreshBalance, refreshCreditLogs } = useAuth();
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mockPaymentEnabled, setMockPaymentEnabled] = useState(false);

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedPackageId) || null,
    [packages, selectedPackageId]
  );

  async function loadOrders() {
    setOrdersLoading(true);
    try {
      setOrders(await getOrders());
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        navigate("/login");
        return;
      }
      setError(friendlyError(loadError));
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getRechargePackages()
      .then((result) => {
        if (!alive) return;
        setPackages(result.packages);
        setSelectedPackageId(result.packages[0]?.id || "");
        setMockPaymentEnabled(Boolean(result.mockPaymentEnabled));
      })
      .catch((loadError) => {
        if (loadError instanceof ApiError && loadError.status === 401) {
          navigate("/login");
          return;
        }
        if (alive) setError(friendlyError(loadError));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    void loadOrders();
    return () => {
      alive = false;
    };
  }, [navigate]);

  async function handleCreateOrder() {
    if (!mockPaymentEnabled) {
      setError("当前环境未开启测试支付，暂不支持在线充值。");
      return;
    }
    if (!selectedPackageId) {
      setError("请选择充值套餐。");
      return;
    }
    setCreating(true);
    setError("");
    setMessage("");
    try {
      const order = await createOrder(selectedPackageId);
      setCurrentOrder(order);
      setOrders((current) => [order, ...current]);
      setMessage("测试订单已创建，请继续完成测试支付。");
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 401) {
        navigate("/login");
        return;
      }
      setError(friendlyError(createError));
    } finally {
      setCreating(false);
    }
  }

  async function handleMockPay(orderId = currentOrder?.id) {
    if (!orderId) return;
    if (!mockPaymentEnabled) {
      setError("当前环境未开启测试支付，无法执行测试支付入账。");
      return;
    }
    setPaying(true);
    setError("");
    setMessage("");
    try {
      const result = await mockPayOrder(orderId);
      setCurrentOrder(result.order);
      setMessage("测试充值成功，积分已到账，本次操作不会产生真实扣款。");
      await Promise.all([refreshBalance(), refreshCreditLogs(), loadOrders()]);
    } catch (payError) {
      if (payError instanceof ApiError && payError.status === 401) {
        navigate("/login");
        return;
      }
      setError(friendlyError(payError));
    } finally {
      setPaying(false);
    }
  }

  return (
    <PageLayout>
      <Card className="recharge-page-card">
        <div className="recharge-main">
          <h1>积分充值</h1>
          <h3>选择充值套餐</h3>
          {error ? <p className="data-error compact">{error}</p> : null}
          {message ? <p className="auth-message success">{message}</p> : null}
          <p className={`secure-line ${mockPaymentEnabled ? "" : "secure-line-warning"}`}>
            <ShieldCheck size={18} />
            {mockPaymentEnabled ? "当前为测试支付，不会产生真实扣款。" : "当前环境未开启测试支付，暂不支持在线充值。"}
          </p>
          <div className="package-grid">
            {packages.map((item, index) => (
              <button className={`package-card ${item.id === selectedPackageId ? "selected" : ""}`} type="button" key={item.id} onClick={() => setSelectedPackageId(item.id)}>
                {item.id === selectedPackageId ? <span className="check-corner"><Check size={16} /></span> : null}
                {index === 1 ? <span className="best-tag">推荐</span> : null}
                <strong>{item.credits} <small>积分</small></strong>
                <p>¥{item.amount}</p>
                <div className="coin-stack" />
              </button>
            ))}
          </div>
          {!loading && packages.length === 0 ? <div className="empty-state">暂无可用充值套餐，请联系管理员。</div> : null}
          {loading ? <div className="empty-state">套餐加载中...</div> : null}

          <h3>测试支付</h3>
          <div className="pay-list">
            <div className="pay-row selected">
              <span className="radio active" />
              <span className="pay-icon mock-pay">M</span>
              <strong>Mock 测试支付</strong>
              <em>{mockPaymentEnabled ? "已开启" : "未开启"}</em>
            </div>
          </div>
          {currentOrder ? (
            <Card className="order-current">
              <div className="card-title-row"><h3>当前测试订单</h3><StatusBadge status={statusType(currentOrder.status)}>{statusLabel(currentOrder.status)}</StatusBadge></div>
              <p><span>订单号</span><strong>{currentOrder.orderNo}</strong></p>
              <p><span>金额</span><strong>¥{currentOrder.amount}</strong></p>
              <p><span>积分</span><strong>{currentOrder.credits}</strong></p>
              <p><span>创建时间</span><strong>{formatTime(currentOrder.createdAt)}</strong></p>
            </Card>
          ) : null}
          <div className="pay-footer">
            <a>← 返回</a>
            {currentOrder?.status === "pending" ? (
              <Button type="button" disabled={paying || !mockPaymentEnabled} onClick={() => handleMockPay()}>
                {paying ? "处理中..." : "测试支付入账"}
              </Button>
            ) : (
              <Button type="button" disabled={creating || !selectedPackageId || !mockPaymentEnabled} onClick={handleCreateOrder}>
                {creating ? "创建中..." : "创建测试订单"}
              </Button>
            )}
          </div>

          <Card className="orders-card">
            <div className="card-title-row"><h3>测试充值订单</h3><button className="mini-action" type="button" onClick={loadOrders}>刷新</button></div>
            <DataTable
              rows={orders}
              columns={[
                { key: "orderNo", title: "订单号", render: (row) => row.orderNo },
                { key: "amount", title: "金额", render: (row) => `¥${row.amount}` },
                { key: "credits", title: "积分", render: (row) => row.credits },
                { key: "provider", title: "支付方式", render: (row) => paymentProviderLabel(row.paymentProvider) },
                { key: "status", title: "状态", render: (row) => <StatusBadge status={statusType(row.status)}>{statusLabel(row.status)}</StatusBadge> },
                { key: "paidAt", title: "支付时间", render: (row) => formatTime(row.paidAt) },
                { key: "createdAt", title: "创建时间", render: (row) => formatTime(row.createdAt) },
                {
                  key: "action",
                  title: "操作",
                  render: (row) =>
                    row.status === "pending" ? (
                      <button className="mini-action" type="button" disabled={paying || !mockPaymentEnabled} onClick={() => handleMockPay(row.id)}>
                        测试支付入账
                      </button>
                    ) : "--"
                }
              ]}
            />
            {!ordersLoading && orders.length === 0 ? <div className="empty-state">暂无充值订单。启用测试支付并创建订单后，这里会显示测试订单记录。</div> : null}
            {ordersLoading ? <div className="empty-state">订单加载中...</div> : null}
          </Card>
        </div>
        <aside className="recharge-summary">
          <div className="coin-hero" />
          <h3>充值信息</h3>
          <div className="summary-lines">
            <p><span>选择套餐</span><strong>{selectedPackage ? `${selectedPackage.credits} 积分` : "--"}</strong></p>
            <p><span>支付金额</span><strong>{selectedPackage ? `¥${selectedPackage.amount}` : "--"}</strong></p>
            <p><span>获得积分</span><strong className="blue">{selectedPackage ? `${selectedPackage.credits} 积分` : "--"}</strong></p>
          </div>
          <div className="summary-lines">
            <p><span>当前积分</span><strong>{balance ?? 0} 积分</strong></p>
            <p><span>充值后积分</span><strong className="blue">{selectedPackage ? (balance ?? 0) + selectedPackage.credits : balance ?? 0} 积分</strong></p>
          </div>
          <div className="benefit-list">
            <p><Sparkles /> <span><strong>高效创作</strong>更多积分，创作更多优质视频内容</span></p>
            <p><Building2 /> <span><strong>专属模板</strong>解锁更多高级模板和创意素材</span></p>
            <p><Zap /> <span><strong>快速生成</strong>享受极速生成通道，节省等待时间</span></p>
            <p><ShieldCheck /> <span><strong>测试支付</strong>仅用于测试环境，不会接入微信、支付宝或银行卡扣款</span></p>
          </div>
          <p className="help-line"><Headphones size={16} /> 遇到问题？<a>联系在线客服</a></p>
        </aside>
      </Card>
    </PageLayout>
  );
}
