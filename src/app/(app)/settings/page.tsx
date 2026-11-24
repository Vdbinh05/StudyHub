import * as React from "react";
import type { Metadata } from "next";
import { SettingsView } from "@/components/layout/settings-view";

export const metadata: Metadata = {
  title: "Cài đặt",
};

export default function SettingsPage() {
  return <SettingsView />;
}
