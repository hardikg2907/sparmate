#include <cstdio>

int main() {
  std::puts("started");
  std::fflush(stdout);
  volatile unsigned long ticks = 0;
  while (true) {
    ticks = ticks + 1;
  }
}
