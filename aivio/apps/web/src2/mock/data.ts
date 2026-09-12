export const recentTasks = [
  { title: "未来城市宣传片", date: "2024-06-20 14:30", status: "已完成", image: "city", progress: "100%" },
  { title: "产品介绍视频", date: "2024-06-20 11:20", status: "生成中 75%", image: "product", progress: "75%" },
  { title: "品牌宣传片", date: "2024-06-19 16:45", status: "排队中", image: "brand", progress: "--" },
  { title: "自然风光视频", date: "2024-06-19 10:30", status: "已完成", image: "nature", progress: "100%" },
  { title: "科技感片头", date: "2024-06-18 09:15", status: "失败", image: "tech", progress: "0%" }
];

export const taskRows = [
  { name: "未来城市宣传片", id: "20240618-143001", duration: "10s", ratio: "16:9", resolution: "1080P", status: "已完成", createdAt: "2024-06-18\n14:30", image: "city" },
  { name: "产品介绍视频", id: "20240618-112008", duration: "15s", ratio: "16:9", resolution: "1080P", status: "生成中 75%", createdAt: "2024-06-18\n11:20", image: "product" },
  { name: "品牌宣传片", id: "20240617-164508", duration: "20s", ratio: "16:9", resolution: "4K", status: "排队中", createdAt: "2024-06-17\n16:45", image: "brand" },
  { name: "自然风光视频", id: "20240616-103001", duration: "10s", ratio: "16:9", resolution: "1080P", status: "已完成", createdAt: "2024-06-16\n10:30", image: "nature" },
  { name: "科技感片头", id: "20240615-091500", duration: "8s", ratio: "16:9", resolution: "1080P", status: "已失败", createdAt: "2024-06-15\n09:15", image: "tech" },
  { name: "产品广告视频", id: "20240614-153245", duration: "15s", ratio: "1:1", resolution: "1080P", status: "已完成", createdAt: "2024-06-14\n15:32", image: "watch" }
];

export const notices = [
  ["AIVio 2.0 版本更新公告", "2024-06-18"],
  ["积分规则调整说明", "2024-06-15"],
  ["关于优化生成速度的通知", "2024-06-12"],
  ["模板中心上新啦", "2024-06-10"]
];

export const inspirations = [
  { title: "赛博朋克城市夜景", text: "霓虹灯闪烁的未来城市，雨天街道与高速穿梭的车流。", image: "cyber" },
  { title: "太空探索", text: "宇航员在外星球地表探索，远处可见行星与舰船。", image: "space" },
  { title: "自然风光", text: "壮丽山脉与湖泊，晨光穿过云层落在森林边缘。", image: "nature" },
  { title: "水下世界", text: "五彩斑斓的珊瑚礁与鱼群，镜头缓慢穿过清澈海水。", image: "ocean" }
];

export const packages = [
  { credits: "500", price: "¥10" },
  { credits: "1000", price: "¥20", selected: true },
  { credits: "2000", price: "¥40" },
  { credits: "5000", price: "¥100" },
  { credits: "10000", price: "¥188", best: true }
];

export const creditLogs = [
  { type: "任务奖励", desc: "完成任务：未来城市宣传片", change: "+100", balance: "1000", time: "2024-06-20 14:30", positive: true },
  { type: "视频生成消耗", desc: "生成视频：未来城市宣传片", change: "-50", balance: "900", time: "2024-06-20 14:20" },
  { type: "积分充值", desc: "充值套餐：1000 积分", change: "+1000", balance: "950", time: "2024-06-20 10:15", positive: true },
  { type: "视频生成消耗", desc: "生成视频：产品介绍视频", change: "-30", balance: "-50", time: "2024-06-19 16:45" },
  { type: "任务奖励", desc: "完成任务：自然风光视频", change: "+100", balance: "-20", time: "2024-06-19 10:30", positive: true },
  { type: "视频生成消耗", desc: "生成视频：品牌宣传片", change: "-40", balance: "-120", time: "2024-06-18 09:15" }
];

export const adminTasks = [
  { id: "TASK202406200001", name: "未来城市宣传片", user: "张三", status: "生成中", progress: "75%", time: "2024-06-20 14:30:21" },
  { id: "TASK202406200002", name: "产品介绍视频", user: "李四", status: "已完成", progress: "100%", time: "2024-06-20 14:28:15" },
  { id: "TASK202406200003", name: "品牌宣传片", user: "王五", status: "排队中", progress: "--", time: "2024-06-20 14:25:10" },
  { id: "TASK202406200004", name: "自然风光视频", user: "赵六", status: "生成中", progress: "30%", time: "2024-06-20 14:20:05" },
  { id: "TASK202406200005", name: "科技感片头", user: "孙七", status: "失败", progress: "0%", time: "2024-06-20 14:18:30" }
];
