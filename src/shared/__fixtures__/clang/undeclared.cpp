#include <iostream>
#include <vector>

int total(const std::vector<int>& values) {
  int sum = 0;
  for (int v : values) {
    sum += v;
  }
  return sum + bonus;
}

int main() {
  std::vector<int> values{1, 2, 3};
  std::cout << total(values) << "\n";
  return 0;
}
