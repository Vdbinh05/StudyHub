import * as React from "react";
import type { Metadata } from "next";
import { ProfileView } from "@/components/layout/profile-view";

export const metadata: Metadata = {
  title: "Hồ sơ cá nhân",
};

export default function ProfilePage() {
  return <ProfileView />;
}
