import * as React from "react";
import { StudySetHub } from "@/components/library/study-set-hub";

export default async function StudySetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StudySetHub setId={id} />;
}
