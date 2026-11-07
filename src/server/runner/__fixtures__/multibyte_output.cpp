#include <cstdio>

int main() {
  for (int i = 0; i < 50000; ++i) std::fputs("\xE2\x82\xAC", stdout);
  return 0;
}
