import { apiRequest } from "../../shared/api/client";

export function checkAuthEmail(email: string) {
  return apiRequest<{ exists: boolean }>(`/auth/check-email?email=${encodeURIComponent(email)}`, { auth: false });
}
