import type { Metadata } from "next";
import { FoldersOverview } from "@/components/library/folders-overview";

export const metadata: Metadata = {
  title: "Thư mục",
};

export default function FoldersPage() {
  return <FoldersOverview />;
}
