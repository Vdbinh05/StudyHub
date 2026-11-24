import * as React from "react";
import { FolderDetailView } from "@/components/library/folder-detail-view";

export default async function FolderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FolderDetailView folderId={id} />;
}
