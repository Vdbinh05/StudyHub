import * as React from "react";
import type { Metadata } from "next";
import { CreateSetForm } from "@/components/library/create-set-form";

export const metadata: Metadata = {
  title: "Tạo học phần mới",
};

export default function NewStudySetPage() {
  return <CreateSetForm />;
}
