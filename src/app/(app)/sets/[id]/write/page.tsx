import * as React from "react";
import type { Metadata } from "next";
import { WriteClient } from "@/components/learning/WriteClient";

export const metadata: Metadata = {
  title: "Chế độ Gõ đáp án (Write) — StudyHub",
  description:
    "Tự nhập câu trả lời để kiểm tra khả năng ghi nhớ chủ động và chấm điểm chuẩn hóa.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WritePage({ params }: PageProps) {
  const { id } = await params;
  return <WriteClient setId={id} />;
}
