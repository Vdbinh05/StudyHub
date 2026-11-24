import * as React from "react";
import type { Metadata } from "next";
import { FlashcardsClient } from "@/components/learning/FlashcardsClient";

export const metadata: Metadata = {
  title: "Thẻ ghi nhớ (Flashcards) — StudyHub",
  description:
    "Học thẻ ghi nhớ với lật thẻ mượt mà và đánh giá lặp lại ngắt quãng SM-2.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FlashcardsPage({ params }: PageProps) {
  const { id } = await params;
  return <FlashcardsClient setId={id} />;
}
