import nodemailer from "nodemailer";
import { env, isProduction, isSmtpConfigured } from "../config/env.js";
import { error as logError, log, warn } from "../utils/logger.js";

type SendVerificationCodePayload = {
  email: string;
  code: string;
  ttlMinutes: number;
};

type SendVerificationCodeResult = {
  delivered: boolean;
  devVerificationCode?: string;
};

const EMAIL_NOT_CONFIGURED_MESSAGE = "邮件服务未配置";
const EMAIL_SENDER_NOT_CONFIGURED_MESSAGE = "邮件发件地址未配置";
const EMAIL_DELIVERY_FAILED_MESSAGE = "验证码发送失败，请稍后重试";
const SMTP_TIMEOUT_MS = 9000;
const RESEND_API_URL = "https://api.resend.com/emails";

function verificationEmailText(code: string, ttlMinutes: number): string {
  return [
    `Your AIVio verification code is: ${code}`,
    `This code is valid for ${ttlMinutes} minute(s).`,
    "If you did not request this email, please ignore it."
  ].join("\n");
}

function getMissingSmtpFields(): string[] {
  const entries: Array<[string, string]> = [
    ["SMTP_HOST", env.smtpHost],
    ["SMTP_USER", env.smtpUser],
    ["SMTP_PASS", env.smtpPass],
    ["SMTP_FROM", env.smtpFrom]
  ];
  return entries.filter(([, value]) => !value.trim()).map(([name]) => name);
}

function getMissingResendFields(): string[] {
  const entries: Array<[string, string]> = [
    ["RESEND_API_KEY", env.resendApiKey],
    ["RESEND_FROM", env.resendFrom]
  ];
  return entries.filter(([, value]) => !value.trim()).map(([name]) => name);
}

function getErrorCode(errorValue: unknown): string | undefined {
  if (typeof errorValue !== "object" || errorValue === null || !("code" in errorValue)) return undefined;
  const code = (errorValue as { code?: unknown }).code;
  return code === undefined ? undefined : String(code);
}

function getErrorMessage(errorValue: unknown): string {
  return errorValue instanceof Error ? errorValue.message : String(errorValue);
}

export class EmailService {
  private transporter = env.emailProvider === "resend" || !isSmtpConfigured()
    ? null
    : nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass
        },
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS
      });

  assertVerificationDeliveryAvailable(): void {
    if (env.emailProvider === "resend") {
      const missing = getMissingResendFields();
      if (missing.length > 0) {
        logError("Resend configuration missing for verification delivery.", { missing });
        if (!env.resendApiKey.trim()) {
          throw Object.assign(new Error(EMAIL_NOT_CONFIGURED_MESSAGE), { status: 500 });
        }
        throw Object.assign(new Error(EMAIL_SENDER_NOT_CONFIGURED_MESSAGE), { status: 500 });
      }
      return;
    }
    if (!isSmtpConfigured() && env.authRequireEmailVerification) {
      const missing = getMissingSmtpFields();
      logError("SMTP configuration missing for verification delivery.", { missing });
      throw Object.assign(new Error(EMAIL_NOT_CONFIGURED_MESSAGE), { status: 500 });
    }
  }

  private async sendViaResend(payload: SendVerificationCodePayload): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SMTP_TIMEOUT_MS);
    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.resendFrom,
          to: [payload.email],
          subject: "AIVio 邮箱验证码",
          text: verificationEmailText(payload.code, payload.ttlMinutes),
          html: `<p>AIVio 邮箱验证码：<strong>${payload.code}</strong></p><p>验证码有效期为 ${payload.ttlMinutes} 分钟。</p>`
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const summary = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
        throw Object.assign(new Error(`Resend API returned HTTP ${response.status}${summary ? `: ${summary}` : ""}`), {
          code: `HTTP_${response.status}`,
          statusCode: response.status
        });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async sendVerificationCode(payload: SendVerificationCodePayload): Promise<SendVerificationCodeResult> {
    const startedAt = Date.now();
    const provider = env.emailProvider === "resend" ? "resend" : "smtp";
    const deliveryMeta = {
      provider,
      targetEmail: payload.email,
      ...(provider === "resend"
        ? {}
        : { smtpHost: env.smtpHost || "", smtpPort: env.smtpPort, smtpSecure: env.smtpSecure }),
      ttlMinutes: payload.ttlMinutes
    };
    log("Starting verification email delivery.", deliveryMeta);

    this.assertVerificationDeliveryAvailable();

    if (provider === "resend") {
      try {
        await this.sendViaResend(payload);
        log("Verification email delivery succeeded.", { ...deliveryMeta, elapsedMs: Date.now() - startedAt });
        return { delivered: true };
      } catch (sendError) {
        const errorName = sendError instanceof Error ? sendError.name : "UnknownError";
        const errorCode = getErrorCode(sendError);
        const errorMessage = getErrorMessage(sendError);
        logError("Verification email delivery failed.", {
          ...deliveryMeta,
          elapsedMs: Date.now() - startedAt,
          error: { name: errorName, code: errorCode, message: errorMessage }
        });
        throw Object.assign(new Error(EMAIL_DELIVERY_FAILED_MESSAGE), { status: 502 });
      }
    }

    if (!this.transporter) {
      if (!isProduction()) {
        warn("SMTP is not configured. Using development verification code fallback.", {
          email: payload.email,
          ttlMinutes: payload.ttlMinutes
        });
        return {
          delivered: false,
          devVerificationCode: payload.code
        };
      }
      throw Object.assign(new Error(EMAIL_NOT_CONFIGURED_MESSAGE), { status: 500 });
    }

    try {
      await this.transporter.sendMail({
        from: env.smtpFrom,
        to: payload.email,
        subject: "AIVio verification code",
        text: verificationEmailText(payload.code, payload.ttlMinutes)
      });
      log("Verification email delivery succeeded.", { ...deliveryMeta, elapsedMs: Date.now() - startedAt });
      return { delivered: true };
    } catch (sendError) {
      const errorName = sendError instanceof Error ? sendError.name : "UnknownError";
      const errorCode = getErrorCode(sendError);
      const errorMessage = getErrorMessage(sendError);
      logError("Verification email delivery failed.", {
        ...deliveryMeta,
        elapsedMs: Date.now() - startedAt,
        error: { name: errorName, code: errorCode, message: errorMessage }
      });
      throw Object.assign(new Error(EMAIL_DELIVERY_FAILED_MESSAGE), { status: 502 });
    }
  }
}

export const emailService = new EmailService();
