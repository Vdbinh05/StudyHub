import * as React from "react";
import type { Metadata } from "next";
import { TestHubClient } from "@/components/exam/TestHubClient";
import { StudyLoadingSkeleton } from "@/components/learning/useStudySetBundle";

export const metadata: Metadata = {
  title: "Thi thử học phần — StudyHub",
  description:
    "Cấu hình và làm bài thi thử tính giờ cho học phần với điều hướng nhanh và tự động lưu đáp án.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TestPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<StudyLoadingSkeleton />}>
      <TestHubClient setId={id} />
    </React.Suspense>
  );
}
