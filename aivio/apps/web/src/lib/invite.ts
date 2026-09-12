import { apiRequest } from "./api";

export type InviteInfo = {
  inviteCode: string;
  canApply: boolean;
  usedInviteCode: string | null;
  inviter: { id: string; email: string; role: string } | null;
};

export function getInviteInfo() {
  return apiRequest<InviteInfo>("/invite/me");
}

export function applyInviteCode(inviteCode: string) {
  return apiRequest<{ inviteCode: string; addedCredits: number; balance: number }>("/invite/apply", { method: "POST", body: JSON.stringify({ inviteCode }) });
}
