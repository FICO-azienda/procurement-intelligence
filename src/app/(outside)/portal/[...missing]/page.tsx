import { notFound } from "next/navigation";

/** An address that is no page of the portal: "not found" inside the portal's own frame — never the workspace's. */
export default function Missing() {
  notFound();
}
