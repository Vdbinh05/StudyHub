import * as React from "react";
import type { Metadata } from "next";
import { CustomPracticeClient } from "@/components/learning/CustomPracticeClient";
import { StudyLoadingSkeleton } from "@/components/learning/useStudySetBundle";

export const metadata: Metadata = {
  title: "Luyện tập tùy chỉnh | StudyHub",
  description:
    "Luyện tập trắc nghiệm tùy chỉnh theo môn học, thư mục, câu chưa làm, câu đã sai hoặc câu gắn sao với phản hồi tức thì.",
};

export default function CustomPracticePage() {
  return (
    <React.Suspense fallback={<StudyLoadingSkeleton />}>
      <CustomPracticeClient />
    </React.Suspense>
  );
}
