import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * From Prisma 7 the connection string no longer lives in `schema.prisma`. The
 * CLI — `migrate`, `db push`, `studio`, `seed` — reads it here, while the
 * application gets it through the `pg` driver adapter in `PrismaService`.
 *
 * Two consequences worth knowing:
 *
 * - `.env` is loaded explicitly at the top. The CLI no longer does it for you,
 *   and without it `DATABASE_URL` is undefined and every command fails with a
 *   message that does not mention the env file.
 * - The seed command is declared here rather than under a `prisma` key in
 *   `package.json`; that key is ignored from 7 onwards.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
