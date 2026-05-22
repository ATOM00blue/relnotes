import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A scratch git repository for tests. */
export class TempRepo {
  private constructor(public readonly dir: string) {}

  static async create(remote?: string): Promise<TempRepo> {
    const dir = await mkdtemp(path.join(tmpdir(), "relnotes-test-"));
    const repo = new TempRepo(dir);
    repo.git("init", "-q");
    repo.git("config", "user.email", "test@example.com");
    repo.git("config", "user.name", "Test User");
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "core.autocrlf", "false");
    if (remote) repo.git("remote", "add", "origin", remote);
    return repo;
  }

  git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  async commit(message: string, fileName?: string): Promise<void> {
    const file = fileName ?? `f-${Math.random().toString(36).slice(2)}.txt`;
    await writeFile(path.join(this.dir, file), `${message}\n`, "utf8");
    this.git("add", "-A");
    // Use --file via stdin-safe approach: write a temp message file.
    const msgFile = path.join(this.dir, ".commit-msg.tmp");
    await writeFile(msgFile, message, "utf8");
    this.git("commit", "-q", "-F", msgFile);
    await rm(msgFile, { force: true });
  }

  tag(name: string): void {
    this.git("tag", name);
  }

  async cleanup(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
