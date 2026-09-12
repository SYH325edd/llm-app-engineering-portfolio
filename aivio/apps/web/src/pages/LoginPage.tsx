import { ChevronDown, Globe, Lock, Mail } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../context/AuthContext";
import { checkAuthEmail } from "../lib/auth";
import { User } from "lucide-react";

function toChineseMessage(message: string): string {
  if (message === "Email is not verified.") {
    return "邮箱尚未验证，请先完成邮箱验证码验证。";
  }
  if (["邮件服务未配置", "邮件发件地址未配置", "验证码发送失败，请稍后重试"].includes(message)) {
    return "验证码发送失败，请稍后重试。";
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

export default function LoginPage() {
  const { login, changePasswordByEmail, sendPasswordResetCode, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [view, setView] = useState<"login" | "forgot">("login");
  const [recoveryMethod, setRecoveryMethod] = useState<"password" | "code">("password");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [resetCodeSentAt, setResetCodeSentAt] = useState<number | null>(null);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [loginNotice, setLoginNotice] = useState("");

  useEffect(() => {
    if (!resetCodeSentAt) {
      setResetCooldown(0);
      return;
    }
    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((resetCodeSentAt + 60000 - Date.now()) / 1000));
      setResetCooldown(remaining);
      if (remaining === 0) setResetCodeSentAt(null);
    };
    updateCooldown();
    const timer = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(timer);
  }, [resetCodeSentAt]);

  function resetRecoveryFields() {
    setCurrentPassword("");
    setRecoveryCode("");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setRecoveryError("");
    setResetCodeSentAt(null);
    setResetCooldown(0);
  }

  function openRecovery() {
    setRecoveryEmail(email);
    setRecoveryMethod("password");
    resetRecoveryFields();
    setLoginNotice("");
    setView("forgot");
  }

  function switchRecoveryMethod(method: "password" | "code") {
    setRecoveryMethod(method);
    resetRecoveryFields();
  }

  function validRecoveryEmail(value: string): boolean {
    return /^[^\s@]+@(qq\.com|gmail\.com)$/.test(value.trim().toLowerCase());
  }

  function validateRecoveryForm(): string | null {
    const normalizedEmail = recoveryEmail.trim().toLowerCase();
    if (!validRecoveryEmail(normalizedEmail)) return "仅支持 QQ邮箱或谷歌邮箱。";
    if (!recoveryNewPassword) return "请输入新密码。";
    if (recoveryNewPassword.length < 8) return "密码至少需要 8 位。";
    if (recoveryNewPassword !== recoveryConfirmPassword) return "两次输入的新密码不一致。";
    return null;
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryError("");
    const validationError = validateRecoveryForm();
    if (validationError) {
      setRecoveryError(validationError);
      return;
    }
    if (!currentPassword) {
      setRecoveryError("请输入原密码。");
      return;
    }
    setRecoveryLoading(true);
    try {
      await changePasswordByEmail(recoveryEmail.trim().toLowerCase(), currentPassword, recoveryNewPassword);
      setEmail(recoveryEmail.trim().toLowerCase());
      setPassword("");
      setError("");
      setLoginNotice("密码修改成功，请重新登录。");
      setView("login");
    } catch (changeError) {
      setRecoveryError(changeError instanceof Error ? changeError.message : "邮箱或原密码错误。");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleSendResetCode() {
    setRecoveryError("");
    const normalizedEmail = recoveryEmail.trim().toLowerCase();
    if (!validRecoveryEmail(normalizedEmail)) {
      setRecoveryError("仅支持 QQ邮箱或谷歌邮箱。");
      return;
    }
    if (resetCooldown > 0) return;
    setRecoveryLoading(true);
    try {
      await sendPasswordResetCode(normalizedEmail);
      setResetCodeSentAt(Date.now());
    } catch (sendError) {
      setRecoveryError(sendError instanceof Error ? sendError.message : "验证码发送失败，请稍后重试。");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryError("");
    const validationError = validateRecoveryForm();
    if (validationError) {
      setRecoveryError(validationError);
      return;
    }
    if (!/^\d{6}$/.test(recoveryCode)) {
      setRecoveryError("请输入 6 位验证码。");
      return;
    }
    setRecoveryLoading(true);
    try {
      await resetPassword(recoveryEmail.trim().toLowerCase(), recoveryCode, recoveryNewPassword);
      setEmail(recoveryEmail.trim().toLowerCase());
      setPassword("");
      setError("");
      setLoginNotice("密码修改成功，请重新登录。");
      setView("login");
    } catch (resetError) {
      setRecoveryError(resetError instanceof Error ? resetError.message : "验证码错误或已过期，请重新获取。");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@(qq\.com|gmail\.com)$/.test(normalizedEmail)) {
      setError("仅支持 QQ邮箱或谷歌邮箱登录。");
      return;
    }
    if (!acceptedPolicy) {
      setError("请先同意用户协议和隐私政策。");
      return;
    }
    setLoading(true);
    try {
      const emailCheck = await checkAuthEmail(normalizedEmail);
      if (!emailCheck.exists) {
        navigate("/register", {
          replace: true,
          state: { email: normalizedEmail, provider: normalizedEmail.endsWith("@gmail.com") ? "gmail" : "qq" }
        });
        return;
      }
      await login(normalizedEmail, password);
      const state = location.state as { from?: string } | null;
      navigate(state?.from || "/", { replace: true });
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "登录失败，请稍后重试。";
      setError(toChineseMessage(message));
    } finally {
      setLoading(false);
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
          {view === "login" ? (
            <form className="auth-card" onSubmit={handleSubmit}>
              <div className="auth-tabs">
                <span className="active">登录</span>
                <Link to="/register">注册</Link>
              </div>
              <label className="input-field">
                <User size={22} />
                <input placeholder="QQ邮箱 / 谷歌邮箱" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="input-field">
                <Lock size={22} />
                <input placeholder="输入密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {loginNotice ? <p className="auth-message success">{loginNotice}</p> : null}
              {error ? <p className="auth-message error">{error}</p> : null}
              <a className="forgot" href="#" onClick={(event) => { event.preventDefault(); openRecovery(); }}>忘记密码?</a>
              <Button className="auth-submit" disabled={loading}>{loading ? "登录中..." : "登录"}</Button>
              <label className="auth-policy">
                <input
                  className="auth-policy-checkbox"
                  type="checkbox"
                  checked={acceptedPolicy}
                  onChange={(event) => setAcceptedPolicy(event.target.checked)}
                  aria-label="同意用户协议和隐私政策"
                />
                <span>登录即表示同意 <a>《用户协议》</a> 和 <a>《隐私政策》</a></span>
              </label>
            </form>
          ) : (
            <form className="auth-card" onSubmit={recoveryMethod === "password" ? handleChangePassword : handleResetPassword}>
              <div className="auth-tabs">
                <span className="active">找回密码</span>
                <button className="auth-recovery-back" type="button" onClick={() => { setEmail(recoveryEmail); setView("login"); }}>返回登录</button>
              </div>
              <div className="auth-recovery-methods">
                <button className={recoveryMethod === "password" ? "active" : ""} type="button" onClick={() => switchRecoveryMethod("password")}>使用原密码修改</button>
                <button className={recoveryMethod === "code" ? "active" : ""} type="button" onClick={() => switchRecoveryMethod("code")}>忘记原密码？使用邮箱验证码重置</button>
              </div>
              <label className="input-field">
                <User size={22} />
                <input placeholder="QQ邮箱 / 谷歌邮箱" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} />
              </label>
              {recoveryMethod === "password" ? (
                <label className="input-field">
                  <Lock size={22} />
                  <input placeholder="原密码" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </label>
              ) : (
                <div className="auth-recovery-code-row">
                  <label className="input-field">
                    <Mail size={22} />
                    <input inputMode="numeric" maxLength={6} placeholder="输入验证码" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                  </label>
                  <button className="auth-recovery-send-button" type="button" onClick={handleSendResetCode} disabled={recoveryLoading || resetCooldown > 0}>
                    {resetCooldown > 0 ? `${resetCooldown}秒后重发` : "发送验证码"}
                  </button>
                </div>
              )}
              <label className="input-field">
                <Lock size={22} />
                <input placeholder="新密码" type="password" value={recoveryNewPassword} onChange={(event) => setRecoveryNewPassword(event.target.value)} />
              </label>
              <label className="input-field">
                <Lock size={22} />
                <input placeholder="确认新密码" type="password" value={recoveryConfirmPassword} onChange={(event) => setRecoveryConfirmPassword(event.target.value)} />
              </label>
              {recoveryError ? <p className="auth-message error">{recoveryError}</p> : null}
              <Button className="auth-submit" disabled={recoveryLoading}>{recoveryMethod === "password" ? "保存新密码" : "重置密码"}</Button>
              <button className="auth-link-button" type="button" onClick={() => { setEmail(recoveryEmail); setView("login"); }}>返回登录</button>
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
