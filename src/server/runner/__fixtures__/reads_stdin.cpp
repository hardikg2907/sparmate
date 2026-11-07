#include <iostream>
#include <string>

int main() {
  std::string line;
  if (!std::getline(std::cin, line)) std::cout << "stdin is empty\n";
  return 0;
}
