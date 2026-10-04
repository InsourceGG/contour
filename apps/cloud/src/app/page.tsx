import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/Landing";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = {
  title: { absolute: "Contour: interfaces tailored to each user, within your rules" },
  description: "Contour lets agents tailor your interface to each user, within your rules. People accept every change, and companies keep control.",
};

export default async function Home() {
  const { data } = await (await userClient()).auth.getUser();
  if (data.user) redirect("/projects");
  return <Landing />;
}
