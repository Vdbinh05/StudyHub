import * as React from "react";
import type { Metadata } from "next";
import { DiagramRouteLoader } from "@/components/diagram/DiagramRouteLoader";

export const metadata: Metadata = {
  title: "Biên tập sơ đồ tương tác",
};

export default async function DiagramEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DiagramRouteLoader diagramId={id} view="edit" />;
}
