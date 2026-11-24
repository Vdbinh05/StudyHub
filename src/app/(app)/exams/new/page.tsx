import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomExamBuilderClient } from "@/components/exam/CustomExamBuilderClient";
import { StudyLoadingSkeleton } from "@/components/learning/useStudySetBundle";

export const metadata: Metadata = {
  title: "Tạo đề thi thử tùy chỉnh — StudyHub",
  description:
    "Trình tạo đề thi thử nhiều môn với 5 chiến lược phân bổ, 8 chính sách chọn câu và chế độ Phủ 100%.",
};

export default function NewCustomExamPage() {
  return (
    <Suspense fallback={<StudyLoadingSkeleton />}>
      <CustomExamBuilderClient />
    </Suspense>
  );
}
