import * as React from "react";
import type { Metadata } from "next";
import { HistoryView } from "@/components/analytics/history-view";

export const metadata: Metadata = {
  title: "Lịch sử học tập",
};

export default function HistoryPage() {
  return <HistoryView />;
}
