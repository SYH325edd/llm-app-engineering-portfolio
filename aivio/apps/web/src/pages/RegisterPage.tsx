import { ChevronDown, Globe, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../context/AuthContext";
import qqMailIcon from "../assets/qq-mail-icon.png";
import { ApiError } from "../lib/api";

function toChineseMessage(message: string): string {
  if (message === "Verification code expired or too many attempts. Please request a new code.") {
    return "验证码已过期或尝试次数过多，请重新获取验证码。";
  }
  if (message === "Email service is not configured.") {
    return "邮箱服务未配置，当前无法发送验证码。";
  }
  if (message === "SMTP is not configured. Missing SMTP_HOST, SMTP_USER, SMTP_PASS or SMTP_FROM.") {
    return "邮箱服务未配置，当前无法发送验证码。";
  }
  if (message === "SMTP email delivery failed. Please try again later.") {
    return "验证码发送失败，请稍后重试。";
  }
  if (message === "邮件服务未配置" || message === "邮件发件地址未配置" || message === "验证码发送失败，请稍后重试") {
    return message === "验证码发送失败，请稍后重试" ? message : "验证码发送失败，请稍后重试。";
  }
  if (message === "Database error. Please try again later.") {
    return "数据库处理失败，请稍后重试。";
  }
  if (message === "Request timed out. Please try again later.") {
    return "注册请求超时，请稍后重试";
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

export default function RegisterPage() {
  const { register, verifyEmailCode, resendEmailCode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as { email?: string; provider?: "qq" | "gmail" } | null;
  const initialEmail = routeState?.email || "";
  const [emailProvider, setEmailProvider] = useState<"qq" | "gmail">(
    routeState?.provider || (initialEmail.toLowerCase().endsWith("@gmail.com") ? "gmail" : "qq")
  );
  const [email, setEmail] = useState(initialEmail);
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");
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

  function switchEmailProvider(provider: "qq" | "gmail") {
    setEmailProvider(provider);
    setEmail("");
    setVerificationCode("");
    setPendingEmail("");
    setError("");
    setSuccess("");
    setDevVerificationCode("");
    setLoading(false);
    setVerifying(false);
    setResending(false);
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!acceptedPolicy) {
      setError("请先同意用户协议和隐私政策。");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const emailPattern = emailProvider === "qq" ? /^[^\s@]+@qq\.com$/ : /^[^\s@]+@gmail\.com$/;
    if (!emailPattern.test(normalizedEmail)) {
      setError(emailProvider === "qq" ? "请输入 QQ邮箱。" : "请输入谷歌邮箱。");
      return;
    }
    setLoading(true);
    try {
      const result = await register(email, password, nickname, inviteCode);
      setPendingEmail(normalizedEmail);
      setSuccess("验证码已发送，请查看邮箱。");
      setDevVerificationCode(result.devVerificationCode || "");
    } catch (registerError) {
      if (registerError instanceof ApiError && registerError.code === "TIMEOUT_ERROR") {
        setError("注册请求超时，请稍后重试");
        return;
      }
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
                <input placeholder={emailProvider === "qq" ? "QQ邮箱" : "谷歌邮箱"} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="input-field">
                <User size={22} />
                <input placeholder="昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} />
              </label>
              <label className="input-field">
                <Lock size={22} />
                <input placeholder="设置密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <label className="input-field">
                <User size={22} />
                <input placeholder="邀请码（选填）" maxLength={6} value={inviteCode} onChange={(event) => setInviteCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))} />
              </label>
              {error ? <p className="auth-message error">{error}</p> : null}
              {success ? <p className="auth-message success">{success}</p> : null}
              <Button className="auth-submit" disabled={loading}>{loading ? "注册中..." : "注册并发送验证码"}</Button>
              <div className="auth-divider" style={{ background: "transparent" }}>
                <span>{emailProvider === "qq" ? "或使用 Google 账户" : "或使用 QQ邮箱"}</span>
              </div>
              <div className="social-row">
                {emailProvider === "qq" ? (
                  <button className="social google" type="button" aria-label="使用 Google 账户" onClick={() => switchEmailProvider("gmail")}>
                    <GoogleLogo />
                  </button>
                ) : (
                  <button className="social qq" type="button" aria-label="使用 QQ邮箱" onClick={() => switchEmailProvider("qq")}>
                    <img
                      className="social-logo"
                      src={qqMailIcon}
                      alt="QQ邮箱"
                      style={{ width: 32, height: 32, objectFit: "contain", display: "block", overflow: "visible" }}
                    />
                  </button>
                )}
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
