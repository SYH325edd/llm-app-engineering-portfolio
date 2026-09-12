import { apiRequest } from "./api";

export function checkAuthEmail(email: string) {
  return apiRequest<{ exists: boolean }>(`/auth/check-email?email=${encodeURIComponent(email)}`, { auth: false });
}
