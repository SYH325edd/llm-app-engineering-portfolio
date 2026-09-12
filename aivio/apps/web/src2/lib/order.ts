import { apiRequest } from "./api";

export type RechargePackage = {
  id: string;
  name: string;
  amount: number;
  credits: number;
  enabled: boolean;
};

export type RechargePackagesResponse = {
  packages: RechargePackage[];
  mockPaymentEnabled: boolean;
};

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded" | string;

export type Order = {
  id: string;
  userId: string;
  orderNo: string;
  amount: number;
  credits: number;
  paymentProvider: string;
  status: OrderStatus;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getRechargePackages() {
  return apiRequest<RechargePackagesResponse>("/recharge/packages");
}

export async function createOrder(packageId: string) {
  const result = await apiRequest<{ order: Order }>("/orders", {
    method: "POST",
    body: JSON.stringify({ packageId })
  });
  return result.order;
}

export async function getOrders() {
  const result = await apiRequest<{ orders: Order[] }>("/orders");
  return result.orders;
}

export async function getOrder(orderId: string) {
  const result = await apiRequest<{ order: Order }>(`/orders/${orderId}`);
  return result.order;
}

export async function mockPayOrder(orderId: string) {
  return apiRequest<{ order: Order; balance: { balance: number }; creditLog: unknown }>(`/orders/${orderId}/mock-pay`, {
    method: "POST"
  });
}
