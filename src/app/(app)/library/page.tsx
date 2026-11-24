import * as React from "react";
import type { Metadata } from "next";
import { LibraryView } from "@/components/library/library-view";

export const metadata: Metadata = {
  title: "Thư viện của tôi",
};

export default function LibraryPage() {
  return <LibraryView />;
}
