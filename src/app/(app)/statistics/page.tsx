import * as React from "react";
import type { Metadata } from "next";
import { StatisticsView } from "@/components/analytics/statistics-view";

export const metadata: Metadata = {
  title: "Thống kê học tập",
};

export default function StatisticsPage() {
  return <StatisticsView />;
}
