-- CreateTable
CREATE TABLE "DemoUsage" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DemoUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoUsage_ip_day_key" ON "DemoUsage"("ip", "day");
