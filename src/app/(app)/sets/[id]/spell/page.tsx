import * as React from "react";
import type { Metadata } from "next";
import { SpellModeClient } from "@/components/learning/SpellModeClient";
import { StudyLoadingSkeleton } from "@/components/learning/useStudySetBundle";

export const metadata: Metadata = {
  title: "Nghe & Gõ (Spell) — StudyHub",
  description:
    "Luyện nghe phát âm và gõ chính tả với âm thanh tải lên, giọng đọc trình duyệt, thang gợi ý 5 cấp độ và so sánh ký tự chi tiết.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SpellPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<StudyLoadingSkeleton />}>
      <SpellModeClient setId={id} />
    </React.Suspense>
  );
}
