import * as React from "react";
import type { Metadata } from "next";
import { LearnClient } from "@/components/learning/LearnClient";

export const metadata: Metadata = {
  title: "Chế độ Học (Learn) — StudyHub",
  description:
    "Học tập thích ứng theo từng vòng câu hỏi và tự động lặp lại câu chưa nắm vững.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LearnPage({ params }: PageProps) {
  const { id } = await params;
  return <LearnClient setId={id} />;
}
