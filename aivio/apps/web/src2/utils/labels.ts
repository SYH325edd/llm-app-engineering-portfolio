export function formatAdminTime(value?: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function label(value: string, labels: Record<string, string>) {
  return labels[value] || value || "--";
}

export function roleLabel(value: string) {
  return label(value, { user: "普通用户", admin: "管理员" });
}

export function userStatusLabel(value: string) {
  return label(value, { active: "正常", disabled: "已禁用" });
}

export function orderStatusLabel(value: string) {
  return label(value, { pending: "待支付", paid: "已支付", failed: "支付失败", cancelled: "已取消", refunded: "已退款" });
}

export function paymentProviderLabel(value: string) {
  return label(value, { mock: "Mock 支付" });
}

export function taskStatusLabel(value: string) {
  return label(value, { pending: "排队中", processing: "生成中", succeeded: "已完成", failed: "已失败", cancelled: "已取消" });
}

export function creditTypeLabel(value: string) {
  return label(value, { recharge: "充值", consume: "生成消耗", refund: "失败退款", admin_adjust: "管理员调整", system_grant: "系统发放" });
}

export function modelTypeLabel(value: string) {
  return label(value, { video: "视频模型", image: "图像模型", chat: "对话模型", audio: "音频模型" });
}

export function inputTypeLabel(value: string) {
  return label(value, { text: "文本", image: "图像", "text,image": "文本 / 图像", "image,text": "图像 / 文本" });
}

export function outputTypeLabel(value: string) {
  return label(value, { video: "视频", image: "图像", text: "文本", audio: "音频" });
}

export function enabledLabel(value: boolean) {
  return value ? "已启用" : "已禁用";
}

export function inputContainsVideoLabel(value: boolean) {
  return value ? "输入包含视频" : "输入不含视频";
}

export function audioModeLabel(value?: string | null) {
  return label(value || "default", { audio: "有声视频", silent: "无声视频", default: "默认" });
}

export function adminActionLabel(value: string) {
  return label(value, {
    adjust_balance: "调整余额",
    disable_user: "禁用用户",
    enable_user: "启用用户",
    update_model: "修改模型",
    create_model: "新增模型",
    delete_model: "删除模型",
    update_provider: "修改供应商",
    create_provider: "新增供应商",
    delete_provider: "删除供应商",
    create_pricing_rule: "新增计费规则",
    update_pricing_rule: "修改计费规则",
    delete_pricing_rule: "删除计费规则",
    mock_pay: "Mock 支付"
  });
}

export function adminTargetLabel(value: string) {
  return label(value, { user: "用户", model: "模型", provider: "供应商", pricing_rule: "计费规则", order: "订单", task: "任务" });
}
