import type { Metadata } from "next";
import { ExamHubClient } from "@/components/exam/ExamHubClient";

export const metadata: Metadata = {
  title: "Trung tâm Đề thi — StudyHub",
  description:
    "Quản lý mẫu đề thi nhiều môn, chu kỳ phủ 100% ngân hàng và lịch sử bài thi thử.",
};

export default function ExamsHubPage() {
  return <ExamHubClient />;
}
