import * as React from "react";
import { FlashcardsClient } from "@/components/learning/FlashcardsClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FlashcardsPage({ params }: PageProps) {
  const { id } = await params;
  return <FlashcardsClient setId={id} />;
}
