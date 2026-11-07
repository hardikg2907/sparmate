#include <cstdio>

int main() {
  for (int i = 0; i < 20000; ++i) std::printf("line %05d 0123456789012345678901234567890123456789\n", i);
  for (int i = 0; i < 4000; ++i) std::fprintf(stderr, "err %05d 0123456789012345678901234567890123456789\n", i);
  return 0;
}
