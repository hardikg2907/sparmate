import { MEMORY_REPORT, STATUS_FD } from "./process";

/** The watch costs under 1% of a core at this gap (about 17 ms of CPU every 2 s) and keeps a fast allocator close to the cap. */
const MEMORY_CHECK_MS = 2;

/** On macOS the hook moves the status pipe to the first free descriptor from here, out of the way of the program's own files. */
const PRIVATE_STATUS_FD = 100;

/**
 * The hook's file name in the build folder. It goes before the user's sources: on macOS initializers run in link
 * order, and on Linux the first entry of the pre-initializer list comes from the first object.
 */
export const PROGRAM_HOOK_FILE = "runner_hook.cpp";

/**
 * C++ linked into every program the runner builds. It reports on STATUS_FD before the user's code runs (an
 * initializer on macOS, a pre-initializer on Linux), after the loader, the system's checks of a fresh binary and the
 * sanitizer runtime are done, so none of that counts against the user's time limit.
 *
 * The user's code cannot run before the report in the normal way. A program that defines its own version of a C
 * library call the hook makes, such as write(), takes over that call and can delay its report, but only up to the
 * start-up limit: the start-up limit plus the user's limit always bounds the run, and the CPU rlimit still applies.
 *
 * On macOS, which has no memory rlimit, a thread then stops the program once its physical footprint passes the cap.
 * The footprint, unlike the resident size, includes compressed and swapped pages, so a program cannot hide memory
 * under pressure, and checking it from inside costs no process start. The thread also ends the process when it is
 * the last thread left, as the last thread would after main() calls pthread_exit().
 *
 * Everything has internal linkage so nothing clashes with the user's names, and it compiles without a warning
 * under the runner's flags. Without the descriptor every call fails and the program runs as normal.
 */
export function programHookSource(memoryCapBytes: number): string {
  if (!Number.isSafeInteger(memoryCapBytes) || memoryCapBytes <= 0) throw new RangeError("The memory cap must be a positive whole number of bytes");
  return `#include <unistd.h>
#ifdef __APPLE__
#include <fcntl.h>
#include <libproc.h>
#include <mach/mach.h>
#include <pthread.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/proc_info.h>
#include <time.h>
#endif

namespace {

const int kStatusFd = ${STATUS_FD};

#ifdef __APPLE__
const int kPrivateStatusFd = ${PRIVATE_STATUS_FD};
const unsigned long long kMemoryCapBytes = ${memoryCapBytes}ULL;
int statusFd = kStatusFd;

unsigned long long footprintBytes() {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, reinterpret_cast<task_info_t>(&info), &count) != KERN_SUCCESS) return 0;
  return info.phys_footprint;
}

bool onlyThreadLeft() {
  proc_taskinfo info;
  return proc_pidinfo(getpid(), PROC_PIDTASKINFO, 0, &info, sizeof info) == static_cast<int>(sizeof info) && info.pti_threadnum <= 1;
}

void* watchMemory(void*) {
  const timespec pause = {0, ${MEMORY_CHECK_MS} * 1000 * 1000};
  for (;;) {
    if (footprintBytes() > kMemoryCapBytes) {
      (void)write(statusFd, "${MEMORY_REPORT}", 1);
      kill(getpid(), SIGKILL);
    }
    if (onlyThreadLeft()) exit(0);
    nanosleep(&pause, nullptr);
  }
}

__attribute__((constructor(101))) void reportStart() {
  // Off fd 3, so the program's own writes there, or a file it opens there, are never read as a report.
  int fd = fcntl(kStatusFd, F_DUPFD_CLOEXEC, kPrivateStatusFd);
  if (fd >= 0) {
    close(kStatusFd);
  } else {
    fd = kStatusFd;
  }
  if (write(fd, "s", 1) != 1) return;
  statusFd = fd;
  pthread_t thread;
  if (pthread_create(&thread, nullptr, watchMemory, nullptr) == 0) {
    pthread_detach(thread);
    return;
  }
  close(fd);
}
#else
void reportStart() {
  if (write(kStatusFd, "s", 1) == 1) close(kStatusFd);
}

__attribute__((section(".preinit_array"), used)) void (*const startEntry)() = reportStart;
#endif

}  // namespace
`;
}
