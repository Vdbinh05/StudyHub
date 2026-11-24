import type { Metadata } from "next";
import { NotFoundView } from "@/components/layout/not-found-view";

export const metadata: Metadata = {
  title: "Không tìm thấy trang",
};

export default function NotFoundPage() {
  return <NotFoundView />;
}
