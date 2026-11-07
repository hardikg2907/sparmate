#include <cstdio>
#include <cstdlib>

int main() {
  int* data = static_cast<int*>(std::malloc(4 * sizeof(int)));
  data[4] = 1;
  std::printf("wrote past the end %d\n", data[4]);
  std::free(data);
  return 0;
}
