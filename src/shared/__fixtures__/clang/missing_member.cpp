#include <iostream>
#include <string>

struct Spot {
  int id;
  bool taken;
};

int main() {
  Spot s{1, false};
  s.release();
  std::cout << s.floor << "\n";
  return 0;
}
