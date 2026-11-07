#include <cstdio>
#include <vector>

int main() {
  std::vector<int> values{1, 2, 3};
  std::puts("about to read out of range");
  std::fflush(stdout);
  std::printf("%d\n", values[10]);
  return 0;
}
