#include <map>

struct Key {
  int id;
};

int main() {
  std::map<Key, int> m;
  Key k{1};
  m[k] = 2;
  return 0;
}
