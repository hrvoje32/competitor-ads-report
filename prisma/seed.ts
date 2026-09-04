import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const brands = ["Opel", "Peugeot", "Renault", "Volkswagen", "Ford", "Toyota", "Hyundai", "Kia"];
async function main() {
  for (const [sortOrder, name] of brands.entries()) await prisma.brand.upsert({ where: { name }, update: { sortOrder }, create: { name, sortOrder } });
}
main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
