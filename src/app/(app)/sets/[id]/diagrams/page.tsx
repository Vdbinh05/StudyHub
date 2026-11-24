import * as React from "react";
import type { Metadata } from "next";
import { StudySetDiagramsHub } from "@/components/diagram/StudySetDiagramsHub";

export const metadata: Metadata = {
  title: "Sơ đồ tương tác",
};

export default async function StudySetDiagramsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StudySetDiagramsHub setId={id} />;
}
