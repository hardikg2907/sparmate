import { MEMORY_REPORT, STATUS_FD } from "./process";

/** One footprint check costs about a microsecond, so a short gap keeps a fast allocator close to the cap for free. */
const MEMORY_CHECK_MS = 2;

/** The hook's file name in the build folder. It goes before the user's sources, because on macOS initializers run in link order. */
export const PROGRAM_HOOK_FILE = "runner_hook.cpp";

/**
 * C++ linked into every program the runner builds, whose initializer runs before any of the user's code.
 *
 * Its write on STATUS_FD tells the runner that the program itself is running, after the loader, the system's checks
 * of a fresh binary and the sanitizer runtime are done, so none of that counts against the user's time limit.
 *
 * On macOS, which has no memory rlimit, a thread then stops the program once its physical footprint passes the cap.
 * The footprint, unlike the resident size, includes compressed and swapped pages, so a program cannot hide memory
 * under pressure, and checking it from inside costs no process start.
 *
 * Everything has internal linkage so nothing clashes with the user's names, and it compiles without a warning
 * under the runner's flags. Without the descriptor every write fails and the program runs as normal.
 */
export function programHookSource(memoryCapBytes: number): string {
  if (!Number.isSafeInteger(memoryCapBytes) || memoryCapBytes <= 0) throw new RangeError("The memory cap must be a positive whole number of bytes");
  return `#include <unistd.h>
#ifdef __APPLE__
#include <mach/mach.h>
#include <pthread.h>
#include <signal.h>
#include <time.h>
#endif

namespace {

const int kStatusFd = ${STATUS_FD};

#ifdef __APPLE__
const unsigned long long kMemoryCapBytes = ${memoryCapBytes}ULL;

unsigned long long footprintBytes() {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, reinterpret_cast<task_info_t>(&info), &count) != KERN_SUCCESS) return 0;
  return info.phys_footprint;
}

void* watchMemory(void*) {
  const timespec pause = {0, ${MEMORY_CHECK_MS} * 1000 * 1000};
  for (;;) {
    if (footprintBytes() > kMemoryCapBytes) {
      (void)write(kStatusFd, "${MEMORY_REPORT}", 1);
      kill(getpid(), SIGKILL);
    }
    nanosleep(&pause, nullptr);
  }
}
#endif

__attribute__((constructor(101))) void reportStart() {
  if (write(kStatusFd, "s", 1) != 1) return;
#ifdef __APPLE__
  pthread_t thread;
  if (pthread_create(&thread, nullptr, watchMemory, nullptr) == 0) {
    pthread_detach(thread);
    return;
  }
#endif
  close(kStatusFd);
}

}  // namespace
`;
}
