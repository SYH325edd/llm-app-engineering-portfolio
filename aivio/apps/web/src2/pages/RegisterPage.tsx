import { ChevronDown, Globe, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../context/AuthContext";
import { Apple } from "lucide-react";

function toChineseMessage(message: string): string {
  if (message === "Verification code expired or too many attempts. Please request a new code.") {
    return "验证码已过期或尝试次数过多，请重新获取验证码。";
  }
  if (message === "Email service is not configured.") {
    return "邮箱服务未配置，当前无法发送验证码。";
  }
  return message;
}

function AuthLogo() {
  return (
    <div className="logo logo-sm auth-logo-source" aria-label="Aivio">
      <span className="logo-mark">
        <span />
      </span>
      <span className="logo-text">Aivio</span>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg className="social-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg className="social-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M16.56 12.9c-.03-2.63 2.15-3.9 2.25-3.96-1.23-1.8-3.13-2.04-3.8-2.07-1.62-.16-3.16.95-3.98.95-.83 0-2.1-.93-3.45-.9-1.78.03-3.42 1.03-4.33 2.62-1.85 3.2-.47 7.93 1.33 10.53.88 1.27 1.93 2.7 3.31 2.65 1.33-.05 1.83-.86 3.44-.86 1.6 0 2.06.86 3.46.83 1.43-.03 2.34-1.3 3.21-2.58 1.01-1.47 1.43-2.9 1.45-2.97-.03-.02-2.86-1.1-2.89-4.24zM13.95 5.16c.73-.89 1.23-2.12 1.09-3.35-1.05.04-2.32.7-3.08 1.58-.68.79-1.27 2.05-1.11 3.25 1.17.09 2.37-.6 3.1-1.48z" />
    </svg>
  );
}

export default function RegisterPage() {
  const { register, verifyEmailCode, resendEmailCode } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [devVerificationCode, setDevVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);

  const verificationStep = useMemo(() => Boolean(pendingEmail), [pendingEmail]);
  const showDevVerificationCode = import.meta.env.DEV && Boolean(devVerificationCode);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const result = await register(email, password, nickname);
      setPendingEmail(email.trim());
      setSuccess("验证码已发送，请查看邮箱。");
      setDevVerificationCode(result.devVerificationCode || "");
    } catch (registerError) {
      const message = registerError instanceof Error ? registerError.message : "注册失败，请稍后重试。";
      setError(toChineseMessage(message));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setVerifying(true);
    try {
      const result = await verifyEmailCode(pendingEmail, verificationCode);
      setSuccess(result.message === "Email verification successful. Please log in." ? "邮箱验证成功，请登录。" : result.message);
      setDevVerificationCode("");
      setTimeout(() => navigate("/login"), 700);
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : "验证码验证失败，请稍后重试。";
      setError(toChineseMessage(message));
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    setError("");
    setSuccess("");
    setResending(true);
    try {
      const result = await resendEmailCode(pendingEmail);
      setSuccess("验证码已重新发送，请查看邮箱。");
      setDevVerificationCode(result.devVerificationCode || "");
    } catch (resendError) {
      const message = resendError instanceof Error ? resendError.message : "重新发送验证码失败，请稍后重试。";
      setError(toChineseMessage(message));
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="auth-page auth-source-page">
      <header className="auth-header">
        <AuthLogo />
        <button className="language-btn" type="button">
          <Globe size={19} />
          简体中文
          <ChevronDown size={16} />
        </button>
      </header>
      <section className="auth-hero">
        <div className="auth-left-panel">
          <div className="brand-panel">
            <div className="hero-mark"><span /></div>
            <h1>Aivio</h1>
            <h2>AI驱动的视频创作平台</h2>
            <p>让想象，成为影像。</p>
          </div>
        </div>
        <div className="auth-right-panel">
          {!verificationStep ? (
            <form className="auth-card register-card" onSubmit={handleRegister}>
              <div className="auth-tabs">
                <Link to="/login">登录</Link>
                <span className="active">注册</span>
              </div>
              <label className="input-field">
                <Mail size={22} />
                <input placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="input-field">
                <User size={22} />
                <input placeholder="昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} />
              </label>
              <label className="input-field">
                <Lock size={22} />
                <input placeholder="设置密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {error ? <p className="auth-message error">{error}</p> : null}
              {success ? <p className="auth-message success">{success}</p> : null}
              <Button className="auth-submit" disabled={loading}>{loading ? "注册中..." : "注册并发送验证码"}</Button>
              <div className="auth-divider">
                <span>或使用以下方式登录</span>
              </div>
              <div className="social-row">
                <button className="social google" type="button" aria-label="使用 Google 登录"><GoogleLogo /></button>
                <button className="social apple" type="button" aria-label="使用 Apple 登录"><AppleLogo /></button>
              </div>
              <p className="auth-tip">注册后系统会发送 6 位数字验证码到你的邮箱。</p>
              <label className="auth-policy">
                <input
                  className="auth-policy-checkbox"
                  type="checkbox"
                  checked={acceptedPolicy}
                  onChange={(event) => setAcceptedPolicy(event.target.checked)}
                  aria-label="同意用户协议和隐私政策"
                />
                <span>注册即表示同意 <a>《用户协议》</a> 和 <a>《隐私政策》</a></span>
              </label>
            </form>
          ) : (
            <form className="auth-card register-card" onSubmit={handleVerify}>
              <div className="auth-tabs">
                <Link to="/login">登录</Link>
                <span className="active">注册</span>
              </div>
              <div className="auth-step-note">
                <ShieldCheck size={18} />
                <span>验证码已发送至 {pendingEmail}，请输入 6 位数字验证码。</span>
              </div>
              <label className="input-field">
                <Mail size={22} />
                <input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="输入 6 位验证码"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>
              {showDevVerificationCode ? <p className="auth-message success">本地调试验证码：{devVerificationCode}</p> : null}
              {error ? <p className="auth-message error">{error}</p> : null}
              {success ? <p className="auth-message success">{success}</p> : null}
              <Button className="auth-submit" disabled={verifying}>{verifying ? "验证中..." : "验证邮箱"}</Button>
              <button className="auth-link-button" type="button" onClick={handleResend} disabled={resending}>
                {resending ? "重新发送中..." : "重新发送验证码"}
              </button>
              <p className="auth-tip">如果收件箱没有看到邮件，请检查垃圾邮箱或稍后重试。</p>
            </form>
          )}
        </div>
      </section>
      <footer className="auth-footer">
        <span>© 2024 Aivio. All rights reserved.</span>
        <span>用户协议</span>
        <span>隐私政策</span>
        <span>联系我们</span>
      </footer>
    </main>
  );
}
