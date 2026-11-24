import * as React from "react";
import type { Metadata } from "next";
import { FolderDetailView } from "@/components/library/folder-detail-view";

export const metadata: Metadata = {
  title: "Chi tiết thư mục",
};

export default async function FolderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FolderDetailView folderId={id} />;
}
