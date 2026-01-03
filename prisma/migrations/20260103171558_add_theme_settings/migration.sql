-- CreateTable
CREATE TABLE "ThemeSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleStart" TIMESTAMP(3),
    "scheduleEnd" TIMESTAMP(3),
    "backgroundUrl" TEXT NOT NULL DEFAULT '',
    "bannerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bannerText" TEXT NOT NULL DEFAULT '',
    "bannerHref" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeSettings_pkey" PRIMARY KEY ("id")
);
