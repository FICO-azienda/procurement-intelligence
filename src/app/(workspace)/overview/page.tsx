import { redirect } from "next/navigation";

/** The overview is the home page now; the long, printable version lives at /report. */
export default function OverviewRedirect() {
  redirect("/");
}
