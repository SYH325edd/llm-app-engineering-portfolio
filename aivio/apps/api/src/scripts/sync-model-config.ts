import { modelRegistryService } from "../modules/models/model-registry.service.js";
import { prisma } from "../infrastructure/database/prisma.js";

async function main(): Promise<void> {
  const result = await modelRegistryService.syncFromConfig();
  console.log(
    JSON.stringify(
      {
        ok: true,
        providersSynced: result.providers,
        modelsSynced: result.models
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
