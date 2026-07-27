import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

type PrismaGlobal = typeof globalThis & {
  __newsPrismaClient?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;

export function getPrismaClient() {
  if (prismaGlobal.__newsPrismaClient) {
    return prismaGlobal.__newsPrismaClient;
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to access the news database.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  if (process.env.NODE_ENV !== "production") {
    prismaGlobal.__newsPrismaClient = prisma;
  }

  return prisma;
}
