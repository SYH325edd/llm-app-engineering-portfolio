import { billingService } from "../services/billing.service.js";
import { prisma } from "../services/database.service.js";

function getArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

async function main(): Promise<void> {
  const email = getArg("email").trim().toLowerCase();
  const amount = Number(getArg("amount"));
  if (!email || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Usage: npm run dev:grant-credits -- --email test@example.com --amount 100");
  }

  const result = await billingService.grantDevCredits(email, amount);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
