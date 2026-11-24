import * as React from "react";
import { MatchClient } from "@/components/learning/MatchClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchPage({ params }: PageProps) {
  const { id } = await params;
  return <MatchClient setId={id} />;
}
