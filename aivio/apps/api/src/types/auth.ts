import type { Request } from "express";

export interface RegisterRequest {
  email?: string;
  password?: string;
  nickname?: string;
  inviteCode?: string;
}

export interface LoginRequest {
  email?: string;
  password?: string;
}

export interface VerifyEmailCodeRequest {
  email?: string;
  code?: string;
}

export interface ResendEmailCodeRequest {
  email?: string;
}

export interface ChangePasswordRequest {
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface SendPasswordResetCodeRequest {
  email?: string;
}

export interface ResetPasswordRequest {
  email?: string;
  code?: string;
  newPassword?: string;
}

export interface RegisterResponse {
  message: string;
  devVerificationCode?: string;
}

export interface VerifyEmailCodeResponse {
  message: string;
  devVerificationCode?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  role: string;
  memberLevel: string;
  balance: number;
  status: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
}
