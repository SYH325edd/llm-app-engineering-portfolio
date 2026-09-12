type MockChartProps = {
  compact?: boolean;
};

export default function MockChart({ compact = false }: MockChartProps) {
  return (
    <div className={`mock-chart ${compact ? "mock-chart-compact" : ""}`}>
      <div className="chart-tabs">
        <span className="active">用户增长</span>
        <span>任务数量</span>
        <span>生成数量</span>
        <span>积分消耗</span>
      </div>
      <div className="chart-area">
        <svg viewBox="0 0 720 240" role="img" aria-label="数据趋势">
          <defs>
            <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3f82ff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3f82ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="chart-fill" d="M0 178 L70 160 L140 145 L210 132 L280 116 L350 128 L420 118 L490 142 L560 130 L630 112 L720 92 L720 240 L0 240 Z" />
          <path className="chart-line" d="M0 178 L70 160 L140 145 L210 132 L280 116 L350 128 L420 118 L490 142 L560 130 L630 112 L720 92" />
          {[0, 70, 140, 210, 280, 350, 420, 490, 560, 630, 720].map((x, index) => (
            <circle key={x} cx={x} cy={[178, 160, 145, 132, 116, 128, 118, 142, 130, 112, 92][index]} r={index === 5 ? 8 : 4} />
          ))}
        </svg>
      </div>
    </div>
  );
}
