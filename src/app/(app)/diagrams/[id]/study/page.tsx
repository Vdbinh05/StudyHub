import * as React from "react";
import type { Metadata } from "next";
import { DiagramRouteLoader } from "@/components/diagram/DiagramRouteLoader";

export const metadata: Metadata = {
  title: "Học với sơ đồ tương tác",
};

export default async function DiagramStudyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DiagramRouteLoader diagramId={id} view="study" />;
}
