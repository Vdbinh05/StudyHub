import * as React from "react";
import { LearnClient } from "@/components/learning/LearnClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LearnPage({ params }: PageProps) {
  const { id } = await params;
  return <LearnClient setId={id} />;
}
