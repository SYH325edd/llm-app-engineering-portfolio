import fs from "node:fs";
import { env } from "./env.js";

export interface RechargePackage {
  id: string;
  name: string;
  amount: number;
  credits: number;
  enabled: boolean;
}

function isValidPackage(item: RechargePackage): boolean {
  return Boolean(
    item.id &&
      item.name &&
      Number.isInteger(item.amount) &&
      item.amount > 0 &&
      Number.isInteger(item.credits) &&
      item.credits > 0
  );
}

export function getRechargePackages(): RechargePackage[] {
  const raw = fs.readFileSync(env.rechargePackagesPath, "utf8");
  const parsed = JSON.parse(raw) as RechargePackage[];
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidPackage);
}

export function getEnabledRechargePackages(): RechargePackage[] {
  return getRechargePackages().filter((item) => item.enabled);
}

export function getRechargePackageById(packageId: string): RechargePackage | undefined {
  return getEnabledRechargePackages().find((item) => item.id === packageId);
}
