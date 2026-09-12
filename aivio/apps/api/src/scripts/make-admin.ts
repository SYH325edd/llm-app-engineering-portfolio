import { prisma } from "../services/database.service.js";

function getArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

async function main(): Promise<void> {
  const email = getArg("email").trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: npm run dev:make-admin -- --email test@example.com");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`User '${email}' was not found.`);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: "admin" }
  });

  console.log(
    JSON.stringify(
      {
        userId: updated.id,
        email: updated.email,
        role: updated.role,
        status: updated.status
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
