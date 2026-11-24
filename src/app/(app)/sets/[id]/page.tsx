import * as React from "react";
import type { Metadata } from "next";
import { StudySetHub } from "@/components/library/study-set-hub";

export const metadata: Metadata = {
  title: "Chi tiết học phần",
};

export default async function StudySetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StudySetHub setId={id} />;
}
