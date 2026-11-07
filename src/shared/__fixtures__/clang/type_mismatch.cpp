#include <map>
#include <string>
#include <vector>

int main() {
  std::vector<int> ids;
  ids.push_back("seven");
  std::map<std::string, int> m;
  m.insert(std::make_pair(1, 2));
  std::string s = 42;
  return 0;
}
