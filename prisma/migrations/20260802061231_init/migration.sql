-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CRYPTO', 'METAL');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "symbol" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "buyingPrice" DOUBLE PRECISION NOT NULL,
    "lastAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT,
    "source" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "relatedAssets" TEXT[],
    "assetType" "AssetType",
    "sentimentScore" DOUBLE PRECISION NOT NULL,
    "sentimentLabel" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatHistory" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "message" TEXT NOT NULL,
    "sources" TEXT[],
    "confidence" DOUBLE PRECISION,
    "toolsUsed" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "assetSymbol" TEXT,
    "data" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Portfolio_assetType_idx" ON "Portfolio"("assetType");

-- CreateIndex
CREATE INDEX "Portfolio_symbol_idx" ON "Portfolio"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "News_url_key" ON "News"("url");

-- CreateIndex
CREATE INDEX "News_publishedAt_idx" ON "News"("publishedAt");

-- CreateIndex
CREATE INDEX "News_sentimentLabel_idx" ON "News"("sentimentLabel");

-- CreateIndex
CREATE INDEX "News_assetType_idx" ON "News"("assetType");

-- CreateIndex
CREATE INDEX "ChatHistory_conversationId_idx" ON "ChatHistory"("conversationId");

-- CreateIndex
CREATE INDEX "ChatHistory_createdAt_idx" ON "ChatHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisCache_cacheKey_key" ON "AnalysisCache"("cacheKey");

-- CreateIndex
CREATE INDEX "AnalysisCache_cacheKey_idx" ON "AnalysisCache"("cacheKey");

-- CreateIndex
CREATE INDEX "AnalysisCache_expiresAt_idx" ON "AnalysisCache"("expiresAt");

-- CreateIndex
CREATE INDEX "AnalysisCache_assetSymbol_idx" ON "AnalysisCache"("assetSymbol");
