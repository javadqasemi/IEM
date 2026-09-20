/*
  Warnings:

  - You are about to drop the column `mfaSecret` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MfaMethod" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "MfaCredentialStatus" AS ENUM ('PENDING', 'VERIFIED');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "mfaSecret";

-- CreateTable
CREATE TABLE "MfaCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MfaMethod" NOT NULL DEFAULT 'TOTP',
    "status" "MfaCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "encryptedSecret" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedStep" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReauthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReauthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MfaCredential_userId_idx" ON "MfaCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaCredential_userId_type_key" ON "MfaCredential"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_tokenHash_key" ON "MfaRecoveryCode"("tokenHash");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaChallenge_tokenHash_key" ON "MfaChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "MfaChallenge_userId_idx" ON "MfaChallenge"("userId");

-- CreateIndex
CREATE INDEX "MfaChallenge_expiresAt_idx" ON "MfaChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReauthToken_tokenHash_key" ON "ReauthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ReauthToken_userId_idx" ON "ReauthToken"("userId");

-- CreateIndex
CREATE INDEX "ReauthToken_expiresAt_idx" ON "ReauthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReauthToken" ADD CONSTRAINT "ReauthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
