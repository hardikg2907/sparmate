#include <iostream>
#include <map>
#include <string>
#include <vector>

int main() {
  std::vector<int> values{1, 2, 3};
  std::map<std::string, int> counts{{"a", 1}, {"b", 2}};
  std::cout << "hello from the candidate\n";
  std::cout << values.size() + counts.size() + 1 << "\n";
  return 0;
}
