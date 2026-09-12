type StatusBadgeProps = {
  status: "success" | "processing" | "waiting" | "failed" | "new" | "normal";
  children: string;
};

export default function StatusBadge({ status, children }: StatusBadgeProps) {
  return <span className={`status status-${status}`}>{children}</span>;
}
