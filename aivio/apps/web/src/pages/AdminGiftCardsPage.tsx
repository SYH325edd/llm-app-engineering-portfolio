import { Check, Copy, Gift, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { createAdminGiftCards, deleteAdminGiftCard, deleteAdminGiftCards, disableAdminGiftCard, getAdminGiftCards } from "../lib/admin";
import type { AdminGiftCard } from "../lib/admin";

const PAGE_SIZE = 10;
const statusLabels: Record<string, string> = { active: "可兑换", redeemed: "已兑换", disabled: "已禁用", expired: "已过期" };
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString() : "永久有效"; }

export default function GiftCardsModule() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<AdminGiftCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [credits, setCredits] = useState("100");
  const [customCredits, setCustomCredits] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [customQuantity, setCustomQuantity] = useState("");
  const [expiryType, setExpiryType] = useState("permanent");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadCards() {
    setLoading(true); setError("");
    try { const result = await getAdminGiftCards({ search, status, page, pageSize: PAGE_SIZE }); setCards(result.items); setTotal(result.total); setSelectedIds([]); }
    catch (requestError) { if (requestError instanceof ApiError && requestError.status === 401) navigate("/login"); else setError(requestError instanceof Error ? requestError.message : "礼品卡列表加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadCards(); }, [page, search, status]);

  async function generate() {
    const selectedCredits = credits === "custom" ? Number(customCredits) : Number(credits);
    const selectedQuantity = quantity === "custom" ? Number(customQuantity) : Number(quantity);
    if (!Number.isInteger(selectedCredits) || selectedCredits <= 0) { setError("手动积分必须是正整数。"); return; }
    if (!Number.isInteger(selectedQuantity) || selectedQuantity <= 0 || selectedQuantity > 1000) { setError("手动数量必须是 1 到 1000 的整数。"); return; }
    if (expiryType === "custom" && (!expiresAt || new Date(expiresAt).getTime() <= Date.now())) { setError("请选择未来的有效过期时间。"); return; }
    setLoading(true); setError("");
    try { await createAdminGiftCards({ credits: selectedCredits, quantity: selectedQuantity, expiryType, expiresAt: expiryType === "custom" ? new Date(expiresAt).toISOString() : undefined }); setMessage(`已生成 ${selectedQuantity} 张礼品卡。`); setPage(1); await loadCards(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "生成失败"); } finally { setLoading(false); }
  }
  async function remove(ids: string[]) {
    if (!ids.length || !window.confirm(`确定删除选中的 ${ids.length} 张礼品卡吗？已兑换礼品卡不能删除。`)) return;
    setLoading(true); setError("");
    try { if (ids.length === 1) await deleteAdminGiftCard(ids[0]); else await deleteAdminGiftCards(ids); setMessage(`已删除 ${ids.length} 张礼品卡。`); await loadCards(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "删除失败"); } finally { setLoading(false); }
  }
  async function disable(card: AdminGiftCard) {
    if (card.status !== "active" || !window.confirm("确定要作废这张礼品卡吗？作废后无法兑换。")) return;
    try { const updated = await disableAdminGiftCard(card.id); setCards((current) => current.map((item) => item.id === card.id ? updated : item)); setMessage("礼品卡已作废。"); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "作废失败"); }
  }
  async function copy(code: string) { try { await navigator.clipboard.writeText(code); setMessage("礼品卡 ID 已复制。"); } catch { setError("复制失败，请手动复制。"); } }
  const selectableIds = cards.filter((card) => card.status !== "redeemed").map((card) => card.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  function toggleAll() { setSelectedIds(allSelected ? [] : selectableIds); }
  function toggleOne(id: string) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  return <>
    {message ? <div className="gift-feedback success"><Check size={16} />{message}<button type="button" aria-label="关闭提示" onClick={() => setMessage("")}><X size={15} /></button></div> : null}
    {error ? <div className="gift-feedback error"><X size={16} />{error}</div> : null}
    <section className="admin-table-card gift-admin-card">
      <div className="admin-table-head gift-card-section-head"><div><h2><Gift size={18} /> 生成礼品卡</h2><p>选择积分、数量和有效期后批量生成。</p></div></div>
      <div className="admin-form-grid gift-admin-form">
        <label>积分额度<select className="gift-control" value={credits} onChange={(event) => setCredits(event.target.value)}>{[100, 500, 1000, 5000, 10000].map((value) => <option key={value} value={value}>{value} 积分</option>)}<option value="custom">手动输入</option></select>{credits === "custom" ? <input className="gift-control" type="number" min="1" step="1" placeholder="请输入正整数" value={customCredits} onChange={(event) => setCustomCredits(event.target.value)} /> : null}</label>
        <label>生成数量<select className="gift-control" value={quantity} onChange={(event) => setQuantity(event.target.value)}>{[1, 5, 10].map((value) => <option key={value} value={value}>{value} 张</option>)}<option value="custom">手动输入</option></select>{quantity === "custom" ? <input className="gift-control" type="number" min="1" max="1000" step="1" placeholder="1-1000" value={customQuantity} onChange={(event) => setCustomQuantity(event.target.value)} /> : null}</label>
        <label>有效期<select className="gift-control" value={expiryType} onChange={(event) => setExpiryType(event.target.value)}><option value="1d">1 天</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="permanent">永久有效</option><option value="custom">手动选择过期时间</option></select>{expiryType === "custom" ? <input className="gift-control" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /> : null}</label>
      </div>
      <button className="admin-action primary gift-generate-button" type="button" disabled={loading} onClick={() => void generate()}>{loading ? "生成中…" : "生成礼品卡"}</button>
    </section>
    <section className="admin-table-card gift-list-card">
      <div className="admin-table-head gift-card-section-head"><div><h2>礼品卡列表</h2><p>共 {total} 张礼品卡，每页 {PAGE_SIZE} 条。</p></div><button className="admin-action danger" type="button" disabled={!selectedIds.length || loading} onClick={() => void remove(selectedIds)}><Trash2 size={14} />一键删除{selectedIds.length ? ` (${selectedIds.length})` : ""}</button></div>
      <div className="gift-card-toolbar"><label className="gift-search"><span>搜索</span><input className="gift-control" placeholder="搜索礼品卡ID或兑换用户邮箱" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><label className="gift-status-filter"><span>状态筛选</span><select className="gift-control" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">全部</option><option value="active">可兑换</option><option value="redeemed">已兑换</option><option value="disabled">已禁用</option><option value="expired">已过期</option></select></label></div>
      <div className="gift-card-table-wrap"><table className="gift-card-table"><thead><tr><th><input className="gift-select-checkbox" type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选可删除礼品卡" /></th><th>礼品卡 ID</th><th>积分额度</th><th>状态</th><th>有效期</th><th>创建时间</th><th>兑换用户</th><th>兑换时间</th><th>操作</th></tr></thead><tbody>{cards.map((card) => <tr key={card.id}><td><input className="gift-select-checkbox" type="checkbox" checked={selectedIds.includes(card.id)} disabled={card.status === "redeemed"} onChange={() => toggleOne(card.id)} aria-label={`选择 ${card.code}`} /></td><td className="gift-card-code">{card.code}</td><td>{card.credits}</td><td><span className={`gift-status gift-status-${card.status}`}>{statusLabels[card.status] || card.status}</span></td><td>{formatDate(card.expiresAt)}</td><td>{formatDate(card.createdAt)}</td><td>{card.redeemedByEmail || "--"}</td><td>{card.redeemedAt ? formatDate(card.redeemedAt) : "--"}</td><td><div className="admin-inline-actions"><button className="admin-action" type="button" onClick={() => void copy(card.code)}><Copy size={14} />复制 ID</button>{card.status === "active" ? <button className="admin-action danger" type="button" onClick={() => void disable(card)}>作废</button> : null}<button className="admin-action danger" type="button" disabled={card.status === "redeemed" || loading} onClick={() => void remove([card.id])}><Trash2 size={14} />删除</button></div></td></tr>)}</tbody></table>{!loading && !cards.length ? <p className="admin-panel-state">暂无符合条件的礼品卡</p> : null}{loading ? <p className="admin-panel-state">正在加载礼品卡…</p> : null}</div>
      <div className="gift-pagination"><span>第 {page} / {totalPages} 页</span><div className="admin-inline-actions"><button className="admin-action" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>上一页</button><button className="admin-action" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>下一页</button></div></div>
    </section>
  </>;
}
