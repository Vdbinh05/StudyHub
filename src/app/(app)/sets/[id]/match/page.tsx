import * as React from "react";
import type { Metadata } from "next";
import { MatchClient } from "@/components/learning/MatchClient";

export const metadata: Metadata = {
  title: "Ghép cặp (Match) — StudyHub",
  description:
    "Ghép câu hỏi với đáp án tương ứng để tăng tốc độ phản xạ và ghi nhớ khái niệm.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchPage({ params }: PageProps) {
  const { id } = await params;
  return <MatchClient setId={id} />;
}
