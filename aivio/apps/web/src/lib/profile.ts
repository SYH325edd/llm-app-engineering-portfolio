import { apiRequest } from "./api";

export type ProfileRecord = {
  id: string; userId: string | null; type: string; amount: number; balanceBefore: number; balanceAfter: number;
  relatedTaskId?: string | null; relatedOrderId?: string | null; remark: string; createdAt: string;
};

export function getProfileRecords(params: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  return apiRequest<{ records: ProfileRecord[]; total: number; page: number; pageSize: number; totalPages: number }>(`/user/credit-logs?${query}`);
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest<{ message: string }>("/user/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}

export type NotificationSettings = { taskCompleted: boolean; taskFailed: boolean; creditChanged: boolean; systemAnnouncement: boolean };

export async function getNotificationSettings() {
  const result = await apiRequest<{ settings: { notifyTaskCompleted: boolean; notifyTaskFailed: boolean; notifyCreditChanged: boolean; notifySystemAnnouncement: boolean } }>("/user/notification-settings");
  return { taskCompleted: result.settings.notifyTaskCompleted, taskFailed: result.settings.notifyTaskFailed, creditChanged: result.settings.notifyCreditChanged, systemAnnouncement: result.settings.notifySystemAnnouncement };
}

export async function saveNotificationSettings(settings: NotificationSettings) {
  const result = await apiRequest<{ settings: { notifyTaskCompleted: boolean; notifyTaskFailed: boolean; notifyCreditChanged: boolean; notifySystemAnnouncement: boolean } }>("/user/notification-settings", { method: "PUT", body: JSON.stringify(settings) });
  return { taskCompleted: result.settings.notifyTaskCompleted, taskFailed: result.settings.notifyTaskFailed, creditChanged: result.settings.notifyCreditChanged, systemAnnouncement: result.settings.notifySystemAnnouncement };
}
