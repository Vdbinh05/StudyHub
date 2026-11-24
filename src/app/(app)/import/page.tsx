import type { Metadata } from "next";
import { ImportHubView } from "@/components/library/import-hub-view";

export const metadata: Metadata = {
  title: "Nhập câu hỏi từ file",
};

export default function ImportHubPage() {
  return <ImportHubView />;
}
