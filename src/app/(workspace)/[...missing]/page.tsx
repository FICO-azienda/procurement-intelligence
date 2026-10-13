import { notFound } from "next/navigation";

/** An address that is no page of the workspace: the "not found" page, inside the workspace's own frame. */
export default function Missing() {
  notFound();
}
