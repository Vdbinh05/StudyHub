import * as React from "react";
import type { Metadata } from "next";
import { PracticeClient } from "@/components/learning/PracticeClient";
import { StudyLoadingSkeleton } from "@/components/learning/useStudySetBundle";

export const metadata: Metadata = {
  title: "Luyện trắc nghiệm — StudyHub",
  description:
    "Luyện tập câu hỏi trắc nghiệm theo chương, câu sai hoặc câu gắn sao với phản hồi tức thì.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PracticePage({ params }: PageProps) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<StudyLoadingSkeleton />}>
      <PracticeClient setId={id} />
    </React.Suspense>
  );
}
