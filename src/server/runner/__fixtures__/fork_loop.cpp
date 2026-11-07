#include <cstdio>
#include <unistd.h>

int main() {
  pid_t child = fork();
  if (child == 0) {
    sleep(1000);
    _exit(0);
  }
  std::printf("child %d\n", static_cast<int>(child));
  std::fflush(stdout);
  while (true) {
  }
}
