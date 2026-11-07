#include <iostream>

int pick(int a) {
  int unused = 3;
  if (a > 1) {
    return 1;
  }
}

int main(int argc, char** argv) {
  std::cout << pick(2) << "\n";
  return 0;
}
