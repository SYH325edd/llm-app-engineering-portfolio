import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { env, getEnv, isProduction } from "../config/env.js";
import { prisma } from "./database.service.js";
import { emailService } from "./email.service.js";
import type {
  JwtPayload,
  ChangePasswordRequest,
  LoginRequest,
  PublicUser,
  RegisterRequest,
  RegisterResponse,
  ResendEmailCodeRequest,
  ResetPasswordRequest,
  SendPasswordResetCodeRequest,
  VerifyEmailCodeRequest,
  VerifyEmailCodeResponse
} from "../types/auth.js";
import { createId } from "../utils/id.js";
import { billingService } from "./billing.service.js";
import { inviteService } from "./invite.service.js";
import { error as logError, toErrorMeta } from "../utils/logger.js";

type DbUser = {
  id: string;
  email: string;
  nickname: string;
  role: string;
  memberLevel: string;
  balance: number;
  status: string;
  emailVerifiedAt: Date | null;
  emailVerificationCodeHash: string | null;
  emailVerificationExpiresAt: Date | null;
  emailVerificationAttempts: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_HASH_PREFIX = "scrypt";
const VERIFICATION_CODE_DIGITS = 6;
const VERIFICATION_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_CODE_TTL_MS = 3 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const REGISTER_SUCCESS_MESSAGE = "Registration successful. Please verify your email code.";
const VERIFY_SUCCESS_MESSAGE = "Email verification successful. Please log in.";
const RESEND_GENERIC_MESSAGE = "If the email exists, a verification code has been sent.";
const EMAIL_NOT_VERIFIED_MESSAGE = "Email is not verified.";
const VERIFICATION_CODE_EXPIRED_MESSAGE = "Verification code expired or too many attempts. Please request a new code.";
const DATABASE_ERROR_MESSAGE = "Database error. Please try again later.";

function normalizeEmail(email: string | undefined): string {
  return String(email || "").trim().toLowerCase();
}

function assertEmail(email: string): void {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Please enter a valid email address."), { status: 400 });
  }
}

function assertPasswordResetEmail(email: string): void {
  if (!/^[^\s@]+@(qq\.com|gmail\.com)$/.test(email)) {
    throw Object.assign(new Error("Only QQ or Gmail addresses are supported."), { status: 400 });
  }
}

function assertPassword(password: string | undefined): string {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw Object.assign(new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`), { status: 400 });
  }
  return value;
}

function assertVerificationCode(code: string | undefined): string {
  const value = String(code || "").trim();
  if (!/^\d{6}$/.test(value)) {
    throw Object.assign(new Error("Please enter the 6-digit verification code."), { status: 400 });
  }
  return value;
}

function getJwtSecret(): string {
  const secret = getEnv("JWT_SECRET").trim();
  if (!secret) {
    throw Object.assign(new Error("JWT_SECRET is not configured."), { status: 500 });
  }
  return secret;
}

function getVerificationSecret(): string {
  return getEnv("JWT_SECRET").trim() || "development-email-verification-secret";
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, salt, hash] = storedHash.split("$");
  if (scheme !== PASSWORD_HASH_PREFIX || !salt || !hash) return false;
  const actual = Buffer.from(hash, "hex");
  const expected = scryptSync(password, salt, actual.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function generateVerificationCode(): string {
  const max = 10 ** VERIFICATION_CODE_DIGITS;
  return String(randomInt(0, max)).padStart(VERIFICATION_CODE_DIGITS, "0");
}

function hashVerificationCode(email: string, code: string): string {
  return createHmac("sha256", getVerificationSecret())
    .update(`${normalizeEmail(email)}:${String(code).trim()}`)
    .digest("hex");
}

function compareVerificationCode(email: string, code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashVerificationCode(email, code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getVerificationExpiration(): Date {
  return new Date(Date.now() + env.emailVerificationCodeTtlMinutes * 60 * 1000);
}

function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest();
  return `${encodedHeader}.${encodedBody}.${base64UrlEncode(signature)}`;
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const [encodedHeader, encodedBody, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedBody || !encodedSignature) {
    throw Object.assign(new Error("Invalid login session."), { status: 401 });
  }
  const expected = base64UrlEncode(createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest());
  if (expected !== encodedSignature) {
    throw Object.assign(new Error("Invalid login session."), { status: 401 });
  }
  const decoded = JSON.parse(base64UrlDecode(encodedBody).toString("utf8")) as JwtPayload & { exp?: number };
  if (!decoded.sub || !decoded.email || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error("Login session expired. Please sign in again."), { status: 401 });
  }
  return { sub: decoded.sub, email: decoded.email };
}

function buildVerificationResponse(
  message: string,
  delivery: { devVerificationCode?: string }
): RegisterResponse | VerifyEmailCodeResponse {
  if (!isProduction() && delivery.devVerificationCode) {
    return { message, devVerificationCode: delivery.devVerificationCode };
  }
  return { message };
}

function hasVerificationExpired(user: {
  emailVerificationCodeHash: string | null;
  emailVerificationExpiresAt: Date | null;
  emailVerificationAttempts: number;
}): boolean {
  if (!user.emailVerificationCodeHash || !user.emailVerificationExpiresAt) return true;
  if (user.emailVerificationAttempts >= VERIFICATION_MAX_ATTEMPTS) return true;
  return user.emailVerificationExpiresAt.getTime() < Date.now();
}

function isPrismaError(error: unknown): error is { code?: string; name?: string } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (typeof candidate.code === "string" && candidate.code.startsWith("P"))
    || (typeof candidate.name === "string" && candidate.name.includes("Prisma"));
}

export function toPublicUser(user: DbUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    memberLevel: user.memberLevel,
    balance: user.balance,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

export class AuthService {
  async checkEmail(email: string): Promise<{ exists: boolean }> {
    const normalizedEmail = normalizeEmail(email);
    assertEmail(normalizedEmail);
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
    return { exists: Boolean(user) };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw Object.assign(new Error("Current password is incorrect."), { status: 400 });
    }
    const password = assertPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } });
    return { message: "Password updated successfully." };
  }

  async changePasswordByEmail(payload: ChangePasswordRequest) {
    const email = normalizeEmail(payload.email);
    assertPasswordResetEmail(email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(String(payload.currentPassword || ""), user.passwordHash)) {
      throw Object.assign(new Error("Email or current password is incorrect."), { status: 400 });
    }
    const password = assertPassword(payload.newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        passwordResetCodeHash: null,
        passwordResetCodeExpiresAt: null,
        passwordResetCodeSentAt: null
      }
    });
    return { message: "Password updated successfully. Please sign in again." };
  }

  async sendPasswordResetCode(payload: SendPasswordResetCodeRequest): Promise<RegisterResponse> {
    const email = normalizeEmail(payload.email);
    assertPasswordResetEmail(email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw Object.assign(new Error("Account does not exist."), { status: 404 });
    }

    const now = Date.now();
    if (user.passwordResetCodeSentAt && now - user.passwordResetCodeSentAt.getTime() < PASSWORD_RESET_COOLDOWN_MS) {
      throw Object.assign(new Error("Verification code sent too frequently. Please retry after 60 seconds."), { status: 429 });
    }

    const code = generateVerificationCode();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetCodeHash: hashVerificationCode(email, code),
        passwordResetCodeExpiresAt: new Date(now + PASSWORD_RESET_CODE_TTL_MS),
        passwordResetCodeSentAt: new Date(now)
      }
    });

    try {
      emailService.assertVerificationDeliveryAvailable();
      const delivery = await emailService.sendVerificationCode({
        email,
        code,
        ttlMinutes: 3
      });
      return buildVerificationResponse("Verification code sent. Please check your email.", delivery) as RegisterResponse;
    } catch (error) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetCodeHash: null,
          passwordResetCodeExpiresAt: null,
          passwordResetCodeSentAt: null
        }
      }).catch(() => undefined);
      throw error;
    }
  }

  async resetPassword(payload: ResetPasswordRequest) {
    const email = normalizeEmail(payload.email);
    assertPasswordResetEmail(email);
    const code = assertVerificationCode(payload.code);
    const password = assertPassword(payload.newPassword);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw Object.assign(new Error("Account does not exist."), { status: 404 });
    }
    if (
      !user.passwordResetCodeHash
      || !user.passwordResetCodeExpiresAt
      || user.passwordResetCodeExpiresAt.getTime() < Date.now()
      || !compareVerificationCode(email, code, user.passwordResetCodeHash)
    ) {
      throw Object.assign(new Error("Verification code is invalid or expired. Please request a new code."), { status: 400 });
    }

    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        passwordResetCodeHash: user.passwordResetCodeHash,
        passwordResetCodeExpiresAt: { gte: new Date() }
      },
      data: {
        passwordHash: hashPassword(password),
        passwordResetCodeHash: null,
        passwordResetCodeExpiresAt: null,
        passwordResetCodeSentAt: null
      }
    });
    if (updated.count !== 1) {
      throw Object.assign(new Error("Verification code is invalid or expired. Please request a new code."), { status: 400 });
    }
    return { message: "Password updated successfully. Please sign in again." };
  }

  async register(payload: RegisterRequest): Promise<RegisterResponse> {
    const email = normalizeEmail(payload.email);
    assertEmail(email);
    const password = assertPassword(payload.password);
    const passwordHash = hashPassword(password);
    const verificationCode = generateVerificationCode();
    const verificationCodeHash = hashVerificationCode(email, verificationCode);
    const verificationExpiresAt = getVerificationExpiration();

    emailService.assertVerificationDeliveryAvailable();
    const inviteCode = payload.inviteCode ? await inviteService.validateRegistrationCode(payload.inviteCode) : null;

    let createdUserId = "";
    try {
      const user = await prisma.user.create({
        data: {
          id: createId(),
          email,
          passwordHash,
          emailVerificationCodeHash: verificationCodeHash,
          emailVerificationExpiresAt: verificationExpiresAt,
          emailVerificationAttempts: 0,
          nickname: String(payload.nickname || "").trim(),
          role: "user",
          status: "active"
        }
      });
      createdUserId = user.id;
      await inviteService.ensureUserInviteCode(user.id);

      const delivery = await emailService.sendVerificationCode({
        email,
        code: verificationCode,
        ttlMinutes: env.emailVerificationCodeTtlMinutes
      });
      if (inviteCode) {
        await prisma.$transaction(async (tx: any) => {
          const current = await tx.user.findUnique({ where: { id: user.id } });
          await inviteService.applyOnRegistration(tx, inviteCode, current);
        });
      }

      return buildVerificationResponse(REGISTER_SUCCESS_MESSAGE, delivery);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw Object.assign(new Error("This email is already registered."), { status: 409 });
      }
      if (createdUserId) {
        await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
      }
      if (isPrismaError(error)) {
        logError("Registration database operation failed.", {
          email,
          error: toErrorMeta(error)
        });
        throw Object.assign(new Error(DATABASE_ERROR_MESSAGE), { status: 500 });
      }
      throw error;
    }
  }

  async verifyEmailCode(payload: VerifyEmailCodeRequest): Promise<VerifyEmailCodeResponse> {
    const email = normalizeEmail(payload.email);
    const code = assertVerificationCode(payload.code);
    assertEmail(email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw Object.assign(new Error("Verification code is incorrect."), { status: 400 });
    }
    if (user.emailVerifiedAt) {
      return { message: VERIFY_SUCCESS_MESSAGE };
    }
    if (hasVerificationExpired(user)) {
      throw Object.assign(new Error(VERIFICATION_CODE_EXPIRED_MESSAGE), { status: 400 });
    }

    const matched = compareVerificationCode(email, code, user.emailVerificationCodeHash!);
    if (!matched) {
      const attempts = user.emailVerificationAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerificationAttempts: attempts }
      });

      if (attempts >= VERIFICATION_MAX_ATTEMPTS) {
        throw Object.assign(new Error(VERIFICATION_CODE_EXPIRED_MESSAGE), { status: 400 });
      }
      throw Object.assign(new Error("Verification code is incorrect."), { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null,
        emailVerificationAttempts: 0
      }
    });

    return { message: VERIFY_SUCCESS_MESSAGE };
  }

  async resendEmailCode(payload: ResendEmailCodeRequest): Promise<RegisterResponse> {
    const email = normalizeEmail(payload.email);
    assertEmail(email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) {
      return { message: RESEND_GENERIC_MESSAGE };
    }

    emailService.assertVerificationDeliveryAvailable();

    const verificationCode = generateVerificationCode();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash: hashVerificationCode(email, verificationCode),
        emailVerificationExpiresAt: getVerificationExpiration(),
        emailVerificationAttempts: 0
      }
    });

    const delivery = await emailService.sendVerificationCode({
      email,
      code: verificationCode,
      ttlMinutes: env.emailVerificationCodeTtlMinutes
    });

    return buildVerificationResponse(RESEND_GENERIC_MESSAGE, delivery);
  }

  async login(payload: LoginRequest): Promise<{ user: PublicUser; token: string }> {
    const email = normalizeEmail(payload.email);
    assertEmail(email);
    const password = String(payload.password || "");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw Object.assign(new Error("Email or password is incorrect."), { status: 401 });
    }
    if (user.status === "disabled") {
      throw Object.assign(new Error("This account has been disabled. Please contact support."), { status: 403 });
    }
    if (user.status !== "active") {
      throw Object.assign(new Error("This account is unavailable. Please contact support."), { status: 403 });
    }

    const matched = verifyPassword(password, user.passwordHash);
    if (!matched) {
      throw Object.assign(new Error("Email or password is incorrect."), { status: 401 });
    }
    if (env.authRequireEmailVerification && !user.emailVerifiedAt) {
      throw Object.assign(new Error(EMAIL_NOT_VERIFIED_MESSAGE), { status: 403 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    await inviteService.ensureUserInviteCode(updated.id);
    const synced = await billingService.syncMemberLevel(prisma, updated.id, updated.balance);
    const publicUser = toPublicUser(synced);
    return { user: publicUser, token: this.signToken(publicUser) };
  }

  async getUserById(id: string): Promise<PublicUser | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    await inviteService.ensureUserInviteCode(id);
    const synced = await billingService.syncMemberLevel(prisma, user.id, user.balance);
    return toPublicUser(synced);
  }

  signToken(user: Pick<PublicUser, "id" | "email">): string {
    return signJwt({ sub: user.id, email: user.email }, getJwtSecret());
  }

  verifyToken(token: string): JwtPayload {
    return verifyJwt(token, getJwtSecret());
  }
}

export const authService = new AuthService();
