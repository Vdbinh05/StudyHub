import * as React from "react";
import type { Metadata } from "next";
import { ExamResultsClient } from "@/components/exam/ExamResultsClient";

export const metadata: Metadata = {
  title: "Kết quả bài thi — StudyHub",
  description:
    "Xem chi tiết điểm số, phân tích theo môn/chương/thẻ và đối chiếu đáp án từng câu hỏi.",
};

interface PageProps {
  params: Promise<{ id: string; attemptId: string }>;
}

export default async function ExamResultsPage({ params }: PageProps) {
  const { id, attemptId } = await params;
  return <ExamResultsClient setId={id} attemptId={attemptId} />;
}
