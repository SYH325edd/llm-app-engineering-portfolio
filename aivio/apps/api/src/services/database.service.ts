import prismaClientPackage from "@prisma/client";

process.env.DATABASE_URL ||= "file:./prisma/dev.db";

type PrismaRuntime = {
  PrismaClient: new () => Record<string, any>;
};

const { PrismaClient } = prismaClientPackage as unknown as PrismaRuntime;

export type PrismaTransaction = Record<string, any>;

export const prisma = new PrismaClient();
