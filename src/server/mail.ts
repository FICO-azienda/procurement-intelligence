/**
 * Messages the platform sends by email. Like every outside service, sending
 * goes through an adapter switched on from the environment — and none is on by
 * default: the app sends nothing, and says so where a message was due.
 *
 *  - MAIL_MODE=file, MAIL_DIR=<folder>: every message is written as a file in
 *    that folder instead of being sent. For development and tests only.
 *  - a real provider: a place with no adapter yet.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  name: string;
  send(mail: Mail): Promise<void>;
}

const fileMailer = (dir: string): Mailer => ({
  name: "file",
  async send(mail) {
    await mkdir(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${mail.to.replace(/[^a-z0-9@._-]/gi, "_")}.txt`;
    await writeFile(path.join(dir, name), `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
  },
});

/** The adapter the environment switches on. Null: email is off. */
export function mailerFromEnv(): Mailer | null {
  if (process.env.MAIL_MODE === "file" && process.env.MAIL_DIR) return fileMailer(process.env.MAIL_DIR);
  return null;
}
