import type { ReactNode } from "react";

type StatCardProps = {
  icon?: ReactNode;
  label: string;
  value: string;
  change?: string;
};

export default function StatCard({ icon, label, value, change }: StatCardProps) {
  return (
    <div className="stat-card">
      {icon ? <div className="stat-icon">{icon}</div> : null}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {change ? <small>{change}</small> : null}
      </div>
      <i className="sparkline" />
    </div>
  );
}
