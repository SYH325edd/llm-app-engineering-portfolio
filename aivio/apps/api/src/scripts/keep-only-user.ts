import { prisma } from "../services/database.service.js";
import type { PrismaTransaction } from "../services/database.service.js";

function getArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

async function main(): Promise<void> {
  const email = (getArg("email") || "ceshi@qq.com").trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: npm run ops:keep-only-user -- --email ceshi@qq.com");
  }

  const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
    const keepUser = await tx.user.findUnique({ where: { email } });
    if (!keepUser) {
      throw new Error(`User '${email}' was not found. Cleanup aborted.`);
    }

    const usersToDelete = await tx.user.findMany({
      where: { id: { not: keepUser.id } },
      select: { id: true, email: true }
    });
    const userIdsToDelete = usersToDelete.map((user: { id: string }) => user.id);

    if (userIdsToDelete.length > 0) {
      await tx.generationTask.updateMany({
        where: { userId: { in: userIdsToDelete } },
        data: { userId: null }
      });
      await tx.creditLog.updateMany({
        where: { userId: { in: userIdsToDelete } },
        data: { userId: null }
      });
      await tx.order.deleteMany({
        where: { userId: { in: userIdsToDelete } }
      });
      await tx.uploadedAsset.deleteMany({
        where: { userId: { in: userIdsToDelete } }
      });
      await tx.user.deleteMany({
        where: { id: { in: userIdsToDelete } }
      });
    }

    const updatedKeepUser = await tx.user.update({
      where: { id: keepUser.id },
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

    return {
      keptUser: updatedKeepUser,
      deletedUsersCount: userIdsToDelete.length,
      deletedUserEmails: usersToDelete.map((user: { email: string }) => user.email)
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
