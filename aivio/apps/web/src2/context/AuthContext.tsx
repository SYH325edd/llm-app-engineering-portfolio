import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, apiRequest, clearStoredToken, getStoredToken, setStoredToken } from "../lib/api";

export type UserRole = "user" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  balance?: number;
  status?: string;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CreditLog = {
  id: string;
  userId: string | null;
  type: "recharge" | "consume" | "refund" | "admin_adjust" | "system_grant" | string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId?: string | null;
  relatedOrderId?: string | null;
  remark: string;
  createdAt: string;
};

type LoginResponse = {
  user: AuthUser;
  token: string;
};

type RegisterResponse = {
  message: string;
  devVerificationCode?: string;
};

type VerifyEmailCodeResponse = {
  message: string;
  devVerificationCode?: string;
};

type MeResponse = {
  user: AuthUser;
};

type BalanceResponse = {
  userId: string;
  email: string;
  balance: number;
};

type CreditLogsResponse = {
  logs: CreditLog[];
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  balance: number | null;
  creditLogs: CreditLog[];
  balanceError: string;
  creditLogsError: string;
  role: UserRole;
  previewRole: UserRole;
  isAuthenticated: boolean;
  loading: boolean;
  balanceLoading: boolean;
  creditLogsLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname: string) => Promise<RegisterResponse>;
  verifyEmailCode: (email: string, code: string) => Promise<VerifyEmailCodeResponse>;
  resendEmailCode: (email: string) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  refreshCreditLogs: () => Promise<void>;
  setPreviewRole: (role: UserRole) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeRole(role: string | undefined): UserRole {
  return role === "admin" ? "admin" : "user";
}

function normalizeAuthUser(user: AuthUser): AuthUser {
  return { ...user, role: normalizeRole(user.role) };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [balance, setBalance] = useState<number | null>(null);
  const [creditLogs, setCreditLogs] = useState<CreditLog[]>([]);
  const [balanceError, setBalanceError] = useState("");
  const [creditLogsError, setCreditLogsError] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [creditLogsLoading, setCreditLogsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewRole, setPreviewRole] = useState<UserRole>("user");

  const clearSession = useCallback(() => {
    clearStoredToken();
    setUser(null);
    setToken(null);
    setBalance(null);
    setCreditLogs([]);
  }, []);

  const handleDataError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 401) {
      clearSession();
      return "登录状态已失效，请重新登录。";
    }
    return error instanceof Error ? error.message : fallback;
  }, [clearSession]);

  const refreshBalance = useCallback(async () => {
    if (!getStoredToken()) {
      setBalance(null);
      return;
    }
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const result = await apiRequest<BalanceResponse>("/user/balance");
      setBalance(result.balance);
      setUser((current) => (current ? { ...current, balance: result.balance } : current));
    } catch (error) {
      setBalanceError(handleDataError(error, "余额信息加载失败，请稍后重试。"));
    } finally {
      setBalanceLoading(false);
    }
  }, [handleDataError]);

  const refreshCreditLogs = useCallback(async () => {
    if (!getStoredToken()) {
      setCreditLogs([]);
      return;
    }
    setCreditLogsLoading(true);
    setCreditLogsError("");
    try {
      const result = await apiRequest<CreditLogsResponse>("/user/credit-logs");
      setCreditLogs(result.logs);
    } catch (error) {
      setCreditLogsError(handleDataError(error, "积分流水加载失败，请稍后重试。"));
    } finally {
      setCreditLogsLoading(false);
    }
  }, [handleDataError]);

  const refreshMe = useCallback(async () => {
    const currentToken = getStoredToken();
    if (!currentToken) {
      clearSession();
      setLoading(false);
      return;
    }

    try {
      const result = await apiRequest<MeResponse>("/auth/me");
      setUser(normalizeAuthUser(result.user));
      setToken(currentToken);
      await Promise.all([refreshBalance(), refreshCreditLogs()]);
    } catch {
      clearSession();
    } finally {
      setLoading(false);
    }
  }, [clearSession, refreshBalance, refreshCreditLogs]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, password })
    });
    setStoredToken(result.token);
    setToken(result.token);
    setUser(normalizeAuthUser(result.user));
    await Promise.all([refreshBalance(), refreshCreditLogs()]);
  }, [refreshBalance, refreshCreditLogs]);

  const register = useCallback(async (email: string, password: string, nickname: string) => {
    return apiRequest<RegisterResponse>("/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, password, nickname })
    });
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    return apiRequest<VerifyEmailCodeResponse>("/auth/verify-email-code", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, code })
    });
  }, []);

  const resendEmailCode = useCallback(async (email: string) => {
    return apiRequest<RegisterResponse>("/auth/resend-email-code", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email })
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // Token cleanup is local; logout endpoint is best-effort for this API.
    } finally {
      clearStoredToken();
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      balance,
      creditLogs,
      balanceError,
      creditLogsError,
      role: user ? normalizeRole(user.role) : previewRole,
      previewRole,
      isAuthenticated: Boolean(user && token),
      loading,
      balanceLoading,
      creditLogsLoading,
      login,
      register,
      verifyEmailCode,
      resendEmailCode,
      logout,
      refreshMe,
      refreshBalance,
      refreshCreditLogs,
      setPreviewRole
    }),
    [
      user,
      token,
      balance,
      creditLogs,
      balanceError,
      creditLogsError,
      previewRole,
      loading,
      balanceLoading,
      creditLogsLoading,
      login,
      register,
      verifyEmailCode,
      resendEmailCode,
      logout,
      refreshMe,
      refreshBalance,
      refreshCreditLogs
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
