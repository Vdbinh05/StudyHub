import type { Metadata } from "next";
import { ExamResultsClient } from "@/components/exam/ExamResultsClient";

export const metadata: Metadata = {
  title: "Kết quả bài thi — StudyHub",
  description:
    "Phân tích điểm số, độ chính xác theo môn học, chương, thẻ và xem lại chi tiết đáp án.",
};

export default async function StandaloneExamResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <ExamResultsClient attemptId={attemptId} />;
}
