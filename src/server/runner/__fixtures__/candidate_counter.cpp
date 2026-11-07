#include <iostream>

class Counter {
 public:
  void add(int n) { total_ += n; }
  int total() const { return total_; }

 private:
  int total_ = 0;
};

int main() {
  std::cout << "CANDIDATE MAIN RAN\n";
  return 3;
}
