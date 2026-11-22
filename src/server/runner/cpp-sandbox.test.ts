import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type CppRunner, createCppRunner } from "./cpp";
import { buildCompileSandboxProfile, buildLinuxSandboxInvocation, buildSandboxProfile, sandboxAvailable } from "./sandbox";
import { fixture, program, useRunnerFolders } from "./__fixtures__/cpp-kit";

let base: string;
let tmpRoot: string;
let runner: CppRunner;
useRunnerFolders((ready) => ({ base, tmpRoot, runner } = ready));

describe("the sandbox is available on this machine", () => {
  it("has sandbox-exec, so the sandbox tests below mean something", () => {
    expect(sandboxAvailable()).toBe(true);
  });
});

describe("sandbox platform choice and refusal", () => {
  it("detects sandbox availability by platform", () => {
    expect(sandboxAvailable("darwin")).toBe(existsSync("/usr/bin/sandbox-exec"));
    expect(sandboxAvailable("win32")).toBe(false);
  });

  it("builds linux sandbox invocation with read-only root, isolated namespaces and limits", () => {
    const inv = buildLinuxSandboxInvocation("/app/prog", "/tmp/build", ["/home/test", "/study"]);
    expect(inv.command).toMatch(/bwrap$/);
    expect(inv.args).toContain("--ro-bind");
    expect(inv.args).not.toContain("--proc");
    expect(inv.args).not.toContain("/proc");
    expect(inv.args).toContain("/dev/null");
    expect(inv.args).toContain("--unshare-all");
    expect(inv.args).toContain("--die-with-parent");
    expect(inv.args).toContain("/tmp/build");
    for (const device of ["null", "zero", "random", "urandom"]) expect(inv.args).toContain(`/dev/${device}`);
  });

  it("binds only the named devices when asked, so a compile can read no endless device", () => {
    const inv = buildLinuxSandboxInvocation("/usr/bin/clang++", "/tmp/build", [], { devices: ["null"] });
    expect(inv.args).toContain("/dev/null");
    for (const device of ["zero", "random", "urandom"]) expect(inv.args).not.toContain(`/dev/${device}`);
  });

  it("lets the compiler read the Xcode license record and nothing else under /Library/Preferences", () => {
    const profile = buildCompileSandboxProfile("/tmp/build", [], ["/Library/Developer/CommandLineTools"]);
    expect(profile).toContain('(allow file-read-data (literal "/Library/Preferences/com.apple.dt.Xcode.plist"))');
    expect(profile).not.toContain('(subpath "/Library/Preferences")');
  });

  it("builds a linux compiler invocation that mounts only the named input file and passes the compiler's arguments", () => {
    const inv = buildLinuxSandboxInvocation("/usr/bin/clang++", "/tmp/build", ["/home/test"], {
      args: ["-fsyntax-only", "--", "/study/lld/a/attempt.cpp"],
      readOnly: ["/study/lld/a/attempt.cpp"],
      limits: { cpuSeconds: 25, addressSpaceBytes: 4294967296 },
    });
    const at = inv.args.indexOf("/study/lld/a/attempt.cpp");
    expect(inv.args.slice(at - 1, at + 2)).toEqual(["--ro-bind", "/study/lld/a/attempt.cpp", "/study/lld/a/attempt.cpp"]);
    expect(inv.args).not.toContain("/study");
    expect(inv.args).not.toContain("/home/test");
    expect(inv.args.slice(-4)).toEqual(["/usr/bin/clang++", "-fsyntax-only", "--", "/study/lld/a/attempt.cpp"]);
    if (inv.args.some((a) => a.endsWith("prlimit"))) {
      expect(inv.args).toContain("--cpu=25");
      expect(inv.args).toContain("--as=4294967296");
    }
  });

  it("refuses to compile code when sandbox is required but unavailable, because the compiler reads files too", async () => {
    const sandboxModule = await import("./sandbox");
    const spy = vi.spyOn(sandboxModule, "sandboxAvailable").mockReturnValue(false);
    try {
      const pickyRunner = createCppRunner({ tmpRoot, sandbox: true });
      const result = await pickyRunner.compileAndRun(fixture("hello.cpp"));
      expect(result.compile.ok).toBe(false);
      expect(result.run).toBeNull();
      expect(result.compile.stderr).toContain("Refusing to compile code: no safe sandbox is available");
      expect(result.compile.diagnostics[0]).toMatchObject({ severity: "error", message: expect.stringContaining("Refusing to compile code") });
      const check = await pickyRunner.syntaxCheck(fixture("hello.cpp"));
      expect(check.ok).toBe(false);
      expect(check.stderr).toContain("Refusing to compile code");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the sandbox", () => {
  // On Linux the program gets its own empty /tmp, so a write there succeeds inside the sandbox and is thrown away
  // with it. What matters on both systems is that the file never appears on the machine.
  const outsideWriteKept = process.platform === "linux" ? /^outside write: (denied|created)/ : /^outside write: denied/;
  const outsidePath = (): string => join(tmpdir(), `ir-sandbox-${Math.random().toString(36).slice(2)}.txt`);
  const writeOutside = (path: string): string =>
    `#include <cerrno>\n#include <cstdio>\n#include <cstring>\nint main() {\n  std::FILE* f = std::fopen("${path}", "w");\n  if (f == nullptr) {\n    std::printf("outside write: denied (%s)\\n", std::strerror(errno));\n    return 0;\n  }\n  std::fputs("x", f);\n  std::fclose(f);\n  std::puts("outside write: created");\n  return 0;\n}\n`;

  it("denies a write outside the build folder, and the file is never created", async () => {
    const target = outsidePath();
    try {
      const { run: ran } = await runner.compileAndRun(await program("outside.cpp", writeOutside(target)));
      expect(ran!.exitCode).toBe(0);
      expect(ran!.stdout).toMatch(outsideWriteKept);
      expect(existsSync(target)).toBe(false);
    } finally {
      await rm(target, { force: true });
    }
  });

  it("proves the denial comes from the sandbox: the same program creates the file without it", async () => {
    const target = outsidePath();
    try {
      const open = createCppRunner({ tmpRoot, sandbox: false });
      const { run: ran } = await open.compileAndRun(await program("outside_control.cpp", writeOutside(target)));
      expect(ran!.stdout).toBe("outside write: created\n");
      expect(existsSync(target)).toBe(true);
    } finally {
      await rm(target, { force: true });
    }
  });

  it("denies a write to a sibling folder of the build folder", async () => {
    const sibling = join(tmpRoot, "sibling-file.txt");
    const { run: ran } = await runner.compileAndRun(await program("sibling.cpp", writeOutside(sibling)));
    expect(ran!.stdout).toMatch(outsideWriteKept);
    expect(existsSync(sibling)).toBe(false);
  });

  it("allows writes inside the build folder and the usual device files", async () => {
    const source = `#include <cstdio>\nint main() {\n  std::FILE* f = std::fopen("inside.txt", "w");\n  if (!f) { std::puts("inside write: FAILED"); return 1; }\n  std::fputs("data", f);\n  std::fclose(f);\n  char buf[8] = {};\n  f = std::fopen("inside.txt", "r");\n  std::fread(buf, 1, 4, f);\n  std::fclose(f);\n  std::FILE* nul = std::fopen("/dev/null", "w");\n  std::fputs("x", nul);\n  std::fclose(nul);\n  std::printf("inside write: %s null: ok\\n", buf);\n  std::fputs("to stderr\\n", stderr);\n  return 0;\n}\n`;
    const { run: ran } = await runner.compileAndRun(await program("inside.cpp", source));
    expect(ran).toMatchObject({ exitCode: 0, stdout: "inside write: data null: ok\n", stderr: "to stderr\n" });
  });

  // A real listener on the machine's loopback, so the control run proves the port is reachable without the sandbox.
  let listener: Server;
  let port: number;
  beforeAll(async () => {
    listener = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    port = (listener.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });

  const connectProgram = (): string =>
    `#include <arpa/inet.h>\n#include <netinet/in.h>\n#include <sys/socket.h>\n#include <unistd.h>\n#include <cerrno>\n#include <cstdio>\nint main() {\n  int s = socket(AF_INET, SOCK_STREAM, 0);\n  sockaddr_in addr{};\n  addr.sin_family = AF_INET;\n  addr.sin_port = htons(${port});\n  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);\n  int r = connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof addr);\n  std::printf("connect=%d errno=%d\\n", r, r == 0 ? 0 : errno);\n  return 0;\n}\n`;

  it("denies a socket connection to 127.0.0.1", async () => {
    const { run: ran } = await runner.compileAndRun(await program("connect.cpp", connectProgram()));
    // macOS says no with EPERM (1). On Linux the program has its own empty network namespace, so the machine's
    // listener is not there and the connection is refused (ECONNREFUSED, 111).
    expect(ran!.stdout).toBe(process.platform === "linux" ? "connect=-1 errno=111\n" : "connect=-1 errno=1\n");
  });

  it("proves the denial comes from the sandbox: without it the connection is made", async () => {
    const open = createCppRunner({ tmpRoot, sandbox: false });
    const { run: ran } = await open.compileAndRun(await program("connect_control.cpp", connectProgram()));
    expect(ran!.stdout).toBe("connect=0 errno=0\n");
  });

  it.skipIf(!sandboxAvailable())("denies reading files under the private root but not inside the build folder", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ir-private-")));
    const build = join(root, "build");
    mkdirSync(build);
    writeFileSync(join(root, "secret.txt"), "secret");
    writeFileSync(join(build, "own.txt"), "own");
    const src = join(build, "r.cpp");
    writeFileSync(
      src,
      "#include <fstream>\n#include <iostream>\nint main(int, char** argv) {\n" +
        "  std::ifstream a(argv[1]); std::ifstream b(argv[2]);\n" +
        '  std::cout << (a.good() ? "secret-read" : "secret-denied") << " " << (b.good() ? "own-read" : "own-denied");\n}\n',
    );
    execFileSync("/usr/bin/clang++", ["-std=c++17", ...(process.platform === "linux" ? ["-stdlib=libc++"] : []), "-o", join(build, "r"), src]);
    const programArgs = [join(root, "secret.txt"), join(build, "own.txt")];
    const box =
      process.platform === "linux"
        ? buildLinuxSandboxInvocation(join(build, "r"), build, [root], { args: programArgs })
        : { command: "/usr/bin/sandbox-exec", args: ["-p", buildSandboxProfile(build, root), join(build, "r"), ...programArgs] };
    const out = execFileSync(box.command, box.args, { cwd: build }).toString();
    rmSync(root, { recursive: true, force: true });
    expect(out).toBe("secret-denied own-read");
  });

  it("builds a profile that denies network and writes, and escapes the folder name", () => {
    const profile = buildSandboxProfile('/tmp/we"ird\\dir');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(allow file-write* (subpath "/tmp/we\\"ird\\\\dir"))');
    for (const device of ["/dev/null", "/dev/tty", "/dev/stdout", "/dev/stderr", "/dev/dtracehelper"]) expect(profile).toContain(`(literal "${device}")`);
    expect(() => buildSandboxProfile("/tmp/new\nline")).toThrow();
  });

  it("works when the temp root's path contains a quote and a backslash", async () => {
    const odd = createCppRunner({ tmpRoot: join(base, 'we"ird\\ root') });
    const source = '#include <cstdio>\nint main() {\n  std::FILE* f = std::fopen("inside.txt", "w");\n  std::puts(f ? "inside ok" : "inside FAILED");\n}\n';
    const { run: ran } = await odd.compileAndRun(await program("weird_root.cpp", source));
    expect(ran!.stdout).toBe("inside ok\n");
    await rm(join(base, 'we"ird\\ root'), { recursive: true, force: true });
  });
});

describe("the compile sandbox", () => {
  const marker = `planted-${Math.random().toString(36).slice(2)}`;
  let secret: string;

  beforeAll(async () => {
    // Outside every build folder and outside the sources folder, like any other file on the machine.
    secret = join(base, "outside-secret.txt");
    await writeFile(secret, `first line ${marker}\nsecond line ${marker}\n`);
  });

  const includeProgram = (): string => `#include "${secret}"\nint main() { return 0; }\n`;
  const incbinProgram = (): string =>
    "#include <cstdio>\n" +
    '#ifdef __APPLE__\n#define BLOB "_blob"\n#define DATA ".const"\n#else\n#define BLOB "blob"\n#define DATA ".section .rodata"\n#endif\n' +
    `__asm__(DATA "\\n.globl " BLOB "\\n" BLOB ":\\n.incbin \\"${secret}\\"\\n.byte 0\\n");\n` +
    'extern "C" const char blob[];\nint main() { std::fputs(blob, stdout); }\n';
  const leaks = (result: { stderr: string; diagnostics: { message: string }[] }): boolean =>
    result.stderr.includes(marker) || result.diagnostics.some((d) => d.message.includes(marker));

  it("refuses an #include of a file outside the build folder in a syntax check, and echoes none of it", async () => {
    const result = await runner.syntaxCheck(await program("include_secret.cpp", includeProgram()));
    expect(result.ok).toBe(false);
    // The macOS sandbox refuses the read; the Linux one never mounts the file.
    expect(result.stderr).toMatch(/Operation not permitted|No such file|file not found/);
    expect(leaks(result)).toBe(false);
  });

  it("refuses the same #include in a build", async () => {
    const result = await runner.compileAndRun(await program("include_secret_build.cpp", includeProgram()));
    expect(result.compile.ok).toBe(false);
    expect(result.run).toBeNull();
    expect(leaks(result.compile)).toBe(false);
  });

  it("refuses an .incbin of a file outside the build folder, so its bytes never reach the program", async () => {
    const result = await runner.compileAndRun(await program("incbin_secret.cpp", incbinProgram()));
    expect(result.compile.ok).toBe(false);
    expect(result.run).toBeNull();
    expect(leaks(result.compile)).toBe(false);
  });

  it("refuses an #include of the file from a tester's harness", async () => {
    const harness = `#include "${secret}"\nint main() { return 0; }\n`;
    const result = await runner.runHarness(fixture("candidate_counter.cpp"), harness);
    expect(result.compile.ok).toBe(false);
    expect(result.run).toBeNull();
    expect(leaks(result.compile)).toBe(false);
  });

  it("refuses an #include that would read forever from a device", async () => {
    const result = await runner.syntaxCheck(await program("include_zero.cpp", '#include "/dev/zero"\nint main() {}\n'));
    expect(result.ok).toBe(false);
    // The macOS sandbox refuses the read; the Linux compile sandbox binds no device but /dev/null.
    expect(result.stderr).toMatch(process.platform === "linux" ? /file not found/ : /Operation not permitted/);
  });

  it("proves the refusals come from the sandbox: without it both tricks read the file", async () => {
    const open = createCppRunner({ tmpRoot, sandbox: false });
    const included = await open.syntaxCheck(await program("include_control.cpp", includeProgram()));
    expect(leaks(included)).toBe(true);
    const embedded = await open.compileAndRun(await program("incbin_control.cpp", incbinProgram()));
    expect(embedded.compile.ok).toBe(true);
    expect(embedded.run!.stdout).toContain(marker);
  });

  const classes = [
    "#include <iostream>",
    "#include <memory>",
    "#include <mutex>",
    "#include <optional>",
    "#include <string>",
    "#include <vector>",
    "",
    "class Shape {",
    " public:",
    "  virtual ~Shape() = default;",
    "  virtual double area() const = 0;",
    "};",
    "",
    "class Square : public Shape {",
    " public:",
    "  explicit Square(double side) : side_(side) {}",
    "  double area() const override { return side_ * side_; }",
    "",
    " private:",
    "  double side_;",
    "};",
    "",
    "class Registry {",
    " public:",
    "  void add(std::unique_ptr<Shape> shape) {",
    "    std::lock_guard<std::mutex> lock(mutex_);",
    "    shapes_.push_back(std::move(shape));",
    "  }",
    "  std::optional<double> largest() const {",
    "    std::lock_guard<std::mutex> lock(mutex_);",
    "    if (shapes_.empty()) return std::nullopt;",
    "    double best = 0;",
    "    for (const auto& s : shapes_) best = s->area() > best ? s->area() : best;",
    "    return best;",
    "  }",
    "",
    " private:",
    "  mutable std::mutex mutex_;",
    "  std::vector<std::unique_ptr<Shape>> shapes_;",
    "};",
    "",
    "int main() {",
    "  Registry registry;",
    "  registry.add(std::make_unique<Square>(2));",
    "  registry.add(std::make_unique<Square>(3));",
    '  std::cout << "largest " << registry.largest().value_or(-1) << "\\n";',
    "}",
    "",
  ];

  it("still builds and runs a normal multi-class program with the standard headers", async () => {
    const result = await runner.compileAndRun(await program("classes.cpp", classes.join("\n")));
    expect(result.compile).toMatchObject({ ok: true, diagnostics: [] });
    expect(result.run).toMatchObject({ exitCode: 0, stdout: "largest 9\n", stderr: "" });
  });

  it("still puts diagnostics on the user's own lines", async () => {
    const broken = [...classes];
    broken[44] = "  registry.add(std::make_unique<Square>(3)) // missing semicolon";
    broken[33] = "    int unused = 0;" + broken[33];
    const path = await program("classes_broken.cpp", broken.join("\n"));
    const check = await runner.syntaxCheck(path);
    expect(check.ok).toBe(false);
    expect(check.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 34, severity: "warning", message: expect.stringContaining("unused variable") }),
        expect.objectContaining({ line: 45, severity: "error", message: expect.stringContaining("expected ';'") }),
      ]),
    );
    const built = await runner.compileAndRun(path);
    expect(built.compile.diagnostics.map((d) => [d.line, d.severity])).toEqual(check.diagnostics.map((d) => [d.line, d.severity]));
  });

  it("builds a profile that reads only the system, the toolchain, the build folder and the named inputs", () => {
    const profile = buildCompileSandboxProfile("/tmp/build", ["/study/lld/a/attempt.cpp"], ["/Library/Developer/CommandLineTools"]);
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(deny file-read-data)");
    expect(profile).toContain('(allow file-write* (subpath "/tmp/build"))');
    expect(profile).toContain('(literal "/study/lld/a/attempt.cpp")');
    expect(profile).not.toContain('(subpath "/study');
    expect(profile).not.toContain("process-fork");
    expect(profile).not.toContain('/dev/zero")');
  });
});
