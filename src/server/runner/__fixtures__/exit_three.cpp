#include <cstdio>

int main() {
  std::puts("before exit");
  std::fputs("a problem on stderr\n", stderr);
  return 3;
}
