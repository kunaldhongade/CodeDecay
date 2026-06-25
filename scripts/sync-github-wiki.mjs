import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const wikiSourceRoot = join(repoRoot, ".github", "wiki");

main();

function main() {
  if (!existsSync(wikiSourceRoot)) {
    fail(`Missing wiki source files in ${wikiSourceRoot}. Run "pnpm docs:prepare" first.`);
  }

  const repository = process.env.GITHUB_REPOSITORY ?? detectRepository();
  const token = process.env.GITHUB_WIKI_TOKEN?.trim() || readGhpToken();
  const remoteUrl = `https://x-access-token:${token}@github.com/${repository}.wiki.git`;
  const wikiUrl = `https://github.com/${repository}/wiki`;
  const newPageUrl = `${wikiUrl}/new`;

  try {
    runGit(["ls-remote", remoteUrl]);
  } catch (error) {
    const details = getCommandErrorDetails(error);
    fail(
      [
        `GitHub wiki git remote is not ready for ${repository}.`,
        "GitHub only provisions the separate .wiki.git repository after the first wiki page exists.",
        `Create any first page once in the GitHub UI: ${newPageUrl}`,
        'Then rerun "pnpm docs:wiki:sync".',
        details ? `Git said: ${details}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "codedecay-wiki-"));
  const cloneDir = join(tempRoot, "wiki");

  try {
    runGit(["clone", remoteUrl, cloneDir]);
    syncWikiFiles(cloneDir);

    const identity = readGitHubIdentity();
    runGit(["-C", cloneDir, "config", "user.name", identity.login]);
    runGit(["-C", cloneDir, "config", "user.email", `${identity.id}+${identity.login}@users.noreply.github.com`]);
    runGit(["-C", cloneDir, "add", "Home.md", "_Sidebar.md"]);

    if (runGit(["-C", cloneDir, "diff", "--cached", "--quiet"], { allowFailure: true }).status === 0) {
      console.log(`GitHub wiki is already up to date: ${wikiUrl}`);
      return;
    }

    runGit(["-C", cloneDir, "commit", "-m", "docs: sync wiki index"]);
    runGit(["-C", cloneDir, "push", "origin", "HEAD"]);
    console.log(`Synced GitHub wiki index: ${wikiUrl}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function syncWikiFiles(targetDir) {
  cpSync(join(wikiSourceRoot, "Home.md"), join(targetDir, "Home.md"));
  cpSync(join(wikiSourceRoot, "_Sidebar.md"), join(targetDir, "_Sidebar.md"));
}

function detectRepository() {
  const remoteUrl = runGit(["config", "--get", "remote.origin.url"]).stdout.trim();
  const match = remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);

  if (!match?.[1]) {
    fail(`Could not detect owner/repo from remote.origin.url: ${remoteUrl}`);
  }

  return match[1];
}

function readGhpToken() {
  const token = execFileSync("ghp", ["auth", "token"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();

  if (!token) {
    fail('ghp returned an empty token. Set GITHUB_WIKI_TOKEN or rerun "ghp auth login".');
  }

  return token;
}

function readGitHubIdentity() {
  const response = execFileSync("ghp", ["api", "user", "--jq", "{login: .login, id: .id}"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();

  const identity = JSON.parse(response);
  if (!identity?.login || !identity?.id) {
    fail(`Could not read GitHub identity from ghp api user: ${response}`);
  }

  return identity;
}

function runGit(args, options = {}) {
  const { allowFailure = false } = options;

  try {
    const stdout = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { status: 0, stdout };
  } catch (error) {
    if (allowFailure) {
      return {
        status: error.status ?? 1,
        stdout: error.stdout?.toString?.() ?? "",
        stderr: error.stderr?.toString?.() ?? ""
      };
    }

    throw error;
  }
}

function getCommandErrorDetails(error) {
  const stderr = error?.stderr?.toString?.().trim();
  if (stderr) {
    return stderr;
  }

  const stdout = error?.stdout?.toString?.().trim();
  if (stdout) {
    return stdout;
  }

  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
