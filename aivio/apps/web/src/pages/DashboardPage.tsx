import { ArrowRight, Crown, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { fetchTasks } from "../lib/video";
import type { GenerationTask } from "../lib/video";

function Thumb({ name }: { name: string }) {
  return <span className={`thumb thumb-${name}`} />;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "排队中",
    processing: "生成中",
    succeeded: "已完成",
    failed: "已失败",
    cancelled: "已取消"
  };
  return labels[status] || status;
}

function statusType(status: string): "success" | "processing" | "waiting" | "failed" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "processing") return "processing";
  return "waiting";
}

export default function DashboardPage() {
  const { isAuthenticated, user } = useAuth();
  const [tasks, setTasks] = useState<GenerationTask[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    fetchTasks()
      .then((items) => {
        if (alive) setTasks(items);
      })
      .catch(() => {
        if (alive) setTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [isAuthenticated]);

  const recentTasks = useMemo(() => tasks.slice(0, 5), [tasks]);
  const succeededTasks = useMemo(() => tasks.filter((task) => task.status === "succeeded").length, [tasks]);
  const activeTasks = useMemo(() => tasks.filter((task) => task.status === "pending" || task.status === "processing").length, [tasks]);
  const failedTasks = useMemo(() => tasks.filter((task) => task.status === "failed" || task.status === "cancelled").length, [tasks]);
  const finishedTasks = succeededTasks + failedTasks;
  const successRate = finishedTasks > 0 ? `${Math.round((succeededTasks / finishedTasks) * 100)}%` : "--";
  const taskStats = useMemo(() => {
    if (tasks.length === 0) return [] as Array<[string, string, string]>;
    return [
      [String(tasks.length), "生成任务", "全部任务"],
      [String(succeededTasks), "已完成", finishedTasks > 0 ? `${successRate} 成功率` : "暂无成功率"],
      [String(activeTasks), "进行中", "排队中与生成中"],
      [String(failedTasks), "失败/取消", "可前往任务页重试"]
    ];
  }, [activeTasks, failedTasks, finishedTasks, successRate, succeededTasks, tasks]);

  return (
    <PageLayout>
      <section className="page-head">
        <h1>欢迎回来，{user?.nickname || user?.email || "创作者"}</h1>
        <p>今天想要创作点什么内容呢?</p>
      </section>
      <section className="feature-grid">
        <Card className="feature-card wide">
          <div>
            <h2>AI 视频生成</h2>
            <p>一键生成高质量视频</p>
            <Link className="round-arrow" to="/create"><ArrowRight size={22} /></Link>
          </div>
          <div className="soft-3d logo-3d" />
        </Card>
        <Card className="feature-card">
          <div>
            <h2>我的任务</h2>
            <p>查看任务进度和历史</p>
            <Link className="round-arrow" to="/tasks"><ArrowRight size={22} /></Link>
          </div>
          <div className="soft-3d panel-3d" />
        </Card>
        <Card className="feature-card">
          <div>
            <h2>模板中心</h2>
            <p>获取更多创意模板</p>
            <Link className="round-arrow" to="/templates"><ArrowRight size={22} /></Link>
          </div>
          <div className="soft-3d cube-3d" />
        </Card>
      </section>
      <section className="dashboard-grid">
        <Card className="recent-card">
          <div className="card-title-row">
            <h3>最近任务</h3>
            <Link to="/tasks">全部任务 <ArrowRight size={15} /></Link>
          </div>
          <div className="recent-list">
            {recentTasks.length > 0 ? recentTasks.map((task) => (
              <div className="recent-item" key={task.id}>
                <Thumb name="tech" />
                <div>
                  <strong>{task.modelDisplayName}</strong>
                  <span>{new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
                <StatusBadge status={statusType(task.status)}>{statusLabel(task.status)}</StatusBadge>
              </div>
            )) : <div className="empty-state">暂无生成任务，完成首次视频生成后，这里会显示你的最近任务。</div>}
          </div>
          <Link className="more-link" to="/tasks">查看更多任务 <ArrowRight size={16} /></Link>
        </Card>
        <div className="side-stack">
          <Card className="notice-card">
            <div className="card-title-row">
              <h3>公告</h3>
              <span>暂无数据</span>
            </div>
            <div className="empty-state">暂无公告数据。</div>
          </Card>
          <Card className="data-card">
            <div className="card-title-row">
              <h3>创作数据</h3>
              <span>真实任务统计</span>
            </div>
            {taskStats.length > 0 ? (
              <div className="mini-stats">
                {taskStats.map(([value, label, detail]) => (
                  <div key={label}><strong>{value}</strong><span>{label}</span><small>{detail}</small></div>
                ))}
              </div>
            ) : <div className="empty-state">暂无统计数据，完成首次视频生成后，这里会显示你的任务数据。</div>}
          </Card>
          <Card className="member-banner">
            <div>
              <h3>AIVio 会员特权</h3>
              <p>享受更多高级功能和专属权益</p>
              <Button icon={<Crown size={16} />} type="button">立即开通</Button>
            </div>
            <div className="crown-orb"><Play size={28} fill="white" /></div>
          </Card>
        </div>
      </section>
    </PageLayout>
  );
}
