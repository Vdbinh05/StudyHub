import * as React from "react";
import { WriteClient } from "@/components/learning/WriteClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WritePage({ params }: PageProps) {
  const { id } = await params;
  return <WriteClient setId={id} />;
}
