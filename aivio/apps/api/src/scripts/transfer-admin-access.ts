import { prisma } from "../services/database.service.js";
import type { PrismaTransaction } from "../services/database.service.js";

function getArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function main(): Promise<void> {
  const adminEmail = normalizeEmail(getArg("admin-email") || "guanliyuan@qq.com");
  const disableEmail = normalizeEmail(getArg("disable-email") || "ceshi@qq.com");

  if (!adminEmail || !disableEmail) {
    throw new Error("Usage: npm run ops:transfer-admin-access -- --admin-email guanliyuan@qq.com --disable-email ceshi@qq.com");
  }
  if (adminEmail === disableEmail) {
    throw new Error("admin-email and disable-email must be different users.");
  }

  const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
    const adminUser = await tx.user.findUnique({ where: { email: adminEmail } });
    if (!adminUser) {
      throw new Error(`User '${adminEmail}' was not found. Register this account first, then run the script again.`);
    }

    const updatedAdmin = await tx.user.update({
      where: { id: adminUser.id },
      data: {
        role: "admin",
        status: "active"
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true
      }
    });

    const disabledUser = await tx.user.findUnique({ where: { email: disableEmail } });
    const updatedDisabled = disabledUser
      ? await tx.user.update({
          where: { id: disabledUser.id },
          data: {
            role: "user",
            status: "disabled"
          },
          select: {
            id: true,
            email: true,
            role: true,
            status: true
          }
        })
      : null;

    return {
      adminUser: updatedAdmin,
      disabledUser: updatedDisabled,
      disabledUserFound: Boolean(updatedDisabled)
    };
  });

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
