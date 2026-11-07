#include <cassert>
#include <iostream>

int main() {
  Counter counter;
  counter.add(1);
  counter.add(2);
  assert(counter.total() == 3);
  std::cout << "harness ok " << counter.total() << "\n";
  return 0;
}
