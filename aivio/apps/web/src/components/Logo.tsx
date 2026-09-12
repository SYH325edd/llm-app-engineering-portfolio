type LogoProps = {
  size?: "sm" | "lg";
};

export default function Logo({ size = "sm" }: LogoProps) {
  return (
    <div className={`logo logo-${size}`} aria-label="AIVio">
      <span className="logo-mark">
        <span />
      </span>
      <span className="logo-text">AIVio</span>
    </div>
  );
}
